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
const LX_SOURCE_URL = (process.env.LX_SOURCE_URL || '').trim().replace(/\/$/, '');
const LX_SOURCE_KEY = (process.env.LX_SOURCE_KEY || '').trim(); // 对应请求头 X-Request-Key，没有可留空
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 60; // 每 IP 每分钟请求上限

// 部署在反向代理（Alwaysdata）之后：信任一层代理，用 req.ip 取真实来源，避免直接信任可伪造的 X-Forwarded-For
app.set('trust proxy', 1);

// 洛雪/第三方常见音质名 -> 本项目音质名
const LEVEL_ALIAS = { '128k': 'standard', '320k': 'exhigh', 'flac': 'lossless', 'flac24bit': 'lossless' };

const crypto = require('crypto');
function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
}

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

setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap.entries()) {
        if (now - record.startTime > RATE_LIMIT_WINDOW_MS) {
            rateLimitMap.delete(ip);
        }
    }
}, 60 * 1000).unref();

const rateLimiter = (req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
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

// ==================== 梯队一：QQ 音乐官方 VKey 解析 ====================
const ALL_FORMATS = {
    lossless: { level: 'lossless', prefix: 'F000', ext: '.flac' },
    exhigh:   { level: 'exhigh',   prefix: 'M800', ext: '.mp3' },
    standard: { level: 'standard', prefix: 'M500', ext: '.mp3' },
    m4a:      { level: 'm4a',      prefix: 'C400', ext: '.m4a' },
};

function getCandidateFormats(requestedLevel) {
    if (requestedLevel === 'lossless') {
        return [ALL_FORMATS.lossless, ALL_FORMATS.exhigh, ALL_FORMATS.standard, ALL_FORMATS.m4a];
    }
    if (requestedLevel === 'exhigh') {
        return [ALL_FORMATS.exhigh, ALL_FORMATS.standard, ALL_FORMATS.m4a];
    }
    return [ALL_FORMATS.standard, ALL_FORMATS.m4a];
}

async function tryQQOfficial(songmid, mediaMid, requestedLevel) {
    const fileMid = mediaMid || songmid;
    const candidateList = getCandidateFormats(requestedLevel);

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    if (QQ_COOKIE) headers['Cookie'] = QQ_COOKIE;

    const response = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', payload, {
        headers,
        timeout: 5000,
    });

    const data = response.data?.req_1?.data;
    const midurlinfo = data?.midurlinfo || [];
    let sip = data?.sip?.[0] || 'https://dl.stream.qqmusic.qq.com/';
    sip = sip.replace(/^http:\/\//i, 'https://');

    for (let i = 0; i < midurlinfo.length; i++) {
        if (midurlinfo[i].purl) {
            return {
                url: sip + midurlinfo[i].purl,
                level: candidateList[i].level,
                format: candidateList[i].ext.replace('.', ''),
                source: 'qq_official'
            };
        }
    }
    return null;
}

// 查询 QQ 歌曲基本信息（当客户端未传入歌曲名时自动反查）
async function getQQSongInfo(songmid) {
    try {
        const payload = {
            comm: { ct: 24, cv: 0 },
            songinfo: {
                method: 'get_song_detail_yqq',
                module: 'music.pf_song_detail_svr',
                param: { song_mid: songmid }
            }
        };
        const res = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', payload, {
            headers: { 'Referer': 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' },
            timeout: 4000
        });
        const track = res.data?.songinfo?.data?.track_info;
        if (track?.name) {
            const title = track.name;
            const artist = track.singer?.map(s => s.name).join(' ') || '';
            return `${title} ${artist}`.trim();
        }
    } catch {}
    return '';
}

// ==================== 梯队二：落雪音乐 (LX Music) 公开音源 ====================
async function tryLxSource(songmid, requestedLevel) {
    if (!LX_SOURCE_URL) return null;
    const qualityMap = { lossless: 'flac', exhigh: '320k', standard: '128k' };
    const q = qualityMap[requestedLevel] || '128k';

    try {
        const targetUrl = `${LX_SOURCE_URL}/url/tx/${songmid}/${q}`;
        const headers = { 'User-Agent': 'LX-Music-API' };
        if (LX_SOURCE_KEY) headers['X-Request-Key'] = LX_SOURCE_KEY;
        const res = await axios.get(targetUrl, { headers, timeout: 5000 });
        const body = res.data;
        // 通用格式 { code: 0, data: "https://..." }；兼容 code 200 与 data.url / url
        const okCode = body && (body.code === undefined || body.code === 0 || body.code === 200);
        const link = typeof body?.data === 'string' ? body.data : (body?.data?.url || body?.url);
        if (okCode && typeof link === 'string' && /^https?:\/\//i.test(link)) {
            return {
                url: link.replace(/^http:\/\//i, 'https://'),
                level: requestedLevel,
                format: q === 'flac' ? 'flac' : 'mp3',
                source: 'lx_music'
            };
        }
    } catch {}
    return null;
}

// ==================== 梯队三：酷我音乐跨平台免 VIP 兜底 ====================
async function tryKuwoFallback(keyword, requestedLevel) {
    if (!keyword) return null;
    try {
        const q = encodeURIComponent(keyword);
        const searchUrl = `http://search.kuwo.cn/r.s?client=kt&all=${q}&pn=0&rn=5&ft=music&rformat=json&encoding=utf8`;
        const sRes = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'okhttp/3.10.0' },
            timeout: 4000
        });

        const rawText = typeof sRes.data === 'string' ? sRes.data : JSON.stringify(sRes.data);
        const jsonStr = rawText.replace(/'/g, '"');
        const sData = JSON.parse(jsonStr);
        const list = sData.abslist || [];
        if (!list.length) return null;

        const kuwoFormat = requestedLevel === 'lossless' ? 'flac' : 'mp3';

        // 尝试匹配前 3 项有效歌曲
        for (const item of list.slice(0, 3)) {
            const rawRid = item.DC_TARGETID || item.MUSICRID || '';
            const rid = rawRid.replace('MUSIC_', '').trim();
            if (!rid) continue;

            try {
                const playUrlApi = `http://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=${rid}&format=${kuwoFormat}&response=url`;
                const pRes = await axios.get(playUrlApi, {
                    headers: { 'User-Agent': 'okhttp/3.10.0' },
                    timeout: 4000
                });
                const playData = pRes.data;
                const playUrl = playData?.url || (typeof playData === 'string' && playData.startsWith('http') ? playData : null);

                if (playUrl) {
                    return {
                        url: playUrl.replace(/^http:\/\//i, 'https://'),
                        level: requestedLevel,
                        format: kuwoFormat,
                        source: 'kuwo_cross_platform',
                        matched_title: (item.SONGNAME || '').replace(/&nbsp;/g, ' '),
                        matched_artist: (item.ARTIST || '').replace(/&nbsp;/g, ' '),
                    };
                }
            } catch {}
        }
    } catch (err) {
        console.error('[Kuwo Fallback Error]', err.message);
    }
    return null;
}

// ==================== 主路由 ====================
app.get('/music/qq_song_kw.php', rateLimiter, async (req, res) => {
    // 1. 访问鉴权
    if (API_TOKEN) {
        const clientToken = String(req.headers['x-api-token'] || req.query.token || '').trim();
        if (!safeEqual(clientToken, API_TOKEN)) {
            return res.status(401).json({ code: 401, msg: '未授权：Token 无效或缺失' });
        }
    }

    // 2. 参数解析
    const songmid = (req.query.id || '').trim();
    if (!songmid || !/^[0-9A-Za-z_-]+$/.test(songmid)) {
        return res.status(400).json({ code: 400, msg: '参数 id (songmid) 格式无效' });
    }

    const mediaMid = (req.query.media_mid || '').trim();
    const rawLevel = (req.query.level || 'standard').toLowerCase();
    const requestedLevel = LEVEL_ALIAS[rawLevel] || rawLevel;
    const songName = (req.query.name || req.query.title || '').trim();
    const songArtist = (req.query.artist || req.query.singer || '').trim();

    // 3. 第一梯队：优先尝试 QQ 音乐官方 VKey
    try {
        const qqResult = await tryQQOfficial(songmid, mediaMid, requestedLevel);
        if (qqResult) {
            return res.json({
                code: 200,
                data: {
                    url: qqResult.url,
                    level: qqResult.level,
                    format: qqResult.format,
                    source: qqResult.source
                }
            });
        }
    } catch (err) {
        console.warn(`[QQ Official Miss/Error] ${songmid}:`, err.message);
    }

    // 4. 第二梯队：若配置了落雪音乐公开源，尝试落雪解析
    try {
        const lxResult = await tryLxSource(songmid, requestedLevel);
        if (lxResult) {
            return res.json({
                code: 200,
                data: {
                    url: lxResult.url,
                    level: lxResult.level,
                    format: lxResult.format,
                    source: lxResult.source
                }
            });
        }
    } catch (err) {
        console.warn(`[LX Source Miss/Error] ${songmid}:`, err.message);
    }

    // 5. 第三梯队：酷我跨平台免 VIP 音源自动搜索匹配
    try {
        let keyword = (songName ? `${songName} ${songArtist}` : '').trim();
        if (!keyword) {
            keyword = await getQQSongInfo(songmid);
        }

        if (keyword) {
            const kwResult = await tryKuwoFallback(keyword, requestedLevel);
            if (kwResult) {
                return res.json({
                    code: 200,
                    data: {
                        url: kwResult.url,
                        level: kwResult.level,
                        format: kwResult.format,
                        source: kwResult.source,
                        match: `${kwResult.matched_artist} - ${kwResult.matched_title}`
                    }
                });
            }
        }
    } catch (err) {
        console.error(`[Kuwo Match Error] ${songmid}:`, err.message);
    }

    // 6. 所有梯队均无法获取
    return res.status(404).json({
        code: 404,
        msg: '暂无该歌曲播放权限，三梯队均未解析成功'
    });
});

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'alwaysdata-music-api-multi-tier',
        tiers: ['qq_official', 'lx_music', 'kuwo_cross_platform'],
        timestamp: Date.now()
    });
});

app.listen(PORT, IP, () => {
    console.log(`Music API (多梯队免VIP引擎) 已启动: ${IP}:${PORT}`);
});
