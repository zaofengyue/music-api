const express = require('express');
const axios = require('axios');
const app = express();

// ==================== 配置与环境变量 ====================
const PORT = process.env.PORT || 8100;
const IP   = process.env.IP || '::';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const API_TOKEN = (process.env.API_TOKEN || '').trim();
const QQ_COOKIE = process.env.QQ_COOKIE || '';
const QQ_UIN    = process.env.QQ_UIN || '0';

// ==================== 中间件：跨域设置 ====================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Token');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ==================== 中间件：简易防刷限流 (每IP每分钟60次) ====================
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

// 定时清理过期记录，防止内存泄漏
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap.entries()) {
        if (now - record.startTime > RATE_LIMIT_WINDOW_MS) {
            rateLimitMap.delete(ip);
        }
    }
}, 60 * 1000);

const rateLimiter = (req, res, next) => {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = rateLimitMap.get(clientIp) || { count: 0, startTime: now };

    if (now - record.startTime > RATE_LIMIT_WINDOW_MS) {
        record.count = 1;
        record.startTime = now;
    } else {
        record.count++;
        if (record.count > RATE_LIMIT_MAX) {
            return res.status(429).json({ code: 429, msg: '请求过于频繁，请稍后再试' });
        }
    }
    rateLimitMap.set(clientIp, record);
    next();
};

// ==================== 音质候选链定义与降级逻辑 ====================
const ALL_FORMATS = {
    lossless: { level: 'lossless', prefix: 'F000', ext: '.flac', name: '无损 FLAC' },
    exhigh:   { level: 'exhigh',   prefix: 'M800', ext: '.mp3',  name: '高品 320k' },
    standard: { level: 'standard', prefix: 'M500', ext: '.mp3',  name: '标清 128k' },
    m4a:      { level: 'm4a',      prefix: 'C400', ext: '.m4a',  name: '标清 M4A' },
};

// 根据用户请求的音质，生成降级尝试列表（优先级由高到低）
function getCandidateFormats(requestedLevel) {
    if (requestedLevel === 'lossless') {
        return [ALL_FORMATS.lossless, ALL_FORMATS.exhigh, ALL_FORMATS.standard, ALL_FORMATS.m4a];
    }
    if (requestedLevel === 'exhigh') {
        return [ALL_FORMATS.exhigh, ALL_FORMATS.standard, ALL_FORMATS.m4a];
    }
    // 默认为 standard
    return [ALL_FORMATS.standard, ALL_FORMATS.m4a];
}

// ==================== 业务接口 ====================
app.get('/music/qq_song_kw.php', rateLimiter, async (req, res) => {
    // 1. Token 鉴权（如果设置了 API_TOKEN）
    if (API_TOKEN) {
        const clientToken = (req.headers['x-api-token'] || req.query.token || '').trim();
        if (clientToken !== API_TOKEN) {
            return res.status(401).json({ code: 401, msg: '未授权：Token 无效或缺失' });
        }
    }

    // 2. 参数校验
    const songmid = (req.query.id || '').trim();
    if (!songmid || !/^[0-9A-Za-z_-]+$/.test(songmid)) {
        return res.status(400).json({ code: 400, msg: '参数 id (songmid) 格式无效' });
    }

    const mediaMid = (req.query.media_mid || '').trim();
    if (mediaMid && !/^[0-9A-Za-z_-]+$/.test(mediaMid)) {
        return res.status(400).json({ code: 400, msg: '参数 media_mid 格式无效' });
    }

    // 拼文件名的基准 mid（优先使用 media_mid，若无则使用 songmid）
    const fileMid = mediaMid || songmid;
    const requestedLevel = (req.query.level || 'standard').toLowerCase();
    const candidateList = getCandidateFormats(requestedLevel);

    // 3. 构建多音质一次性批量查询载荷（避免多次网络往返）
    const filenames = candidateList.map(c => `${c.prefix}${fileMid}${c.ext}`);
    const songmids  = candidateList.map(() => songmid);
    const songtypes = candidateList.map(() => 0);
    const guid      = Math.floor(Math.random() * 1000000000).toString();

    const payload = {
        req_1: {
            module: 'vkey.GetVkey',
            method: 'CgiGetVkey',
            param: {
                guid: guid,
                songmid: songmids,
                filename: filenames,
                songtype: songtypes,
                uin: QQ_UIN,
                loginflag: 1,
                platform: '20'
            }
        }
    };

    const headers = {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    };
    if (QQ_COOKIE) {
        headers['Cookie'] = QQ_COOKIE;
    }

    try {
        const response = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', payload, {
            headers: headers,
            timeout: 8000, // 8 秒超时保护
        });

        // 4. 检查上游响应有效性
        if (!response.data || response.data.code !== 0) {
            return res.status(502).json({ code: 502, msg: '上游接口响应异常' });
        }

        const data = response.data.req_1?.data;
        if (!data || response.data.req_1.code !== 0) {
            return res.status(502).json({ code: 502, msg: '上游 VKey 服务处理失败' });
        }

        const midurlinfo = data.midurlinfo || [];
        // 5. 强制将 sip 协议升级为 https，避免浏览器的混合内容 (Mixed Content) 拦截
        let sip = data.sip?.[0] || 'https://dl.stream.qqmusic.qq.com/';
        sip = sip.replace(/^http:\/\//i, 'https://');

        // 6. 按优先级顺序查找第一个获取到有效 purl 的音质（降级机制）
        let matchedIndex = -1;
        for (let i = 0; i < midurlinfo.length; i++) {
            if (midurlinfo[i].purl) {
                matchedIndex = i;
                break;
            }
        }

        if (matchedIndex !== -1) {
            const matchedFormat = candidateList[matchedIndex];
            const purl = midurlinfo[matchedIndex].purl;
            const playUrl = sip + purl;

            return res.json({
                code: 200,
                data: {
                    url: playUrl,
                    level: matchedFormat.level,
                    format: matchedFormat.ext.replace('.', ''),
                    is_fallback: matchedFormat.level !== requestedLevel,
                    requested_level: requestedLevel
                }
            });
        } else {
            return res.status(404).json({
                code: 404,
                msg: '暂无该歌曲播放权限（可能需要 VIP 账号或未在大陆地区）'
            });
        }
    } catch (err) {
        // 7. 异常脱敏：记录日志到服务器控制台，不向客户端泄露详细堆栈
        console.error(`[Error] 歌曲解析失败 [${songmid}]:`, err.message);
        if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
            return res.status(504).json({ code: 504, msg: '请求上游接口超时' });
        }
        return res.status(500).json({ code: 500, msg: '服务器内部错误，请稍后重试' });
    }
});

// 健康检查路由
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'alwaysdata-music-api',
        timestamp: Date.now()
    });
});

app.listen(PORT, IP, () => {
    console.log(`Music API 服务已启动: ${IP}:${PORT}`);
});
