const express = require('express');
const axios = require('axios');
const app = express();

// 允许所有跨域请求
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// QQ 音乐音质配置
const FILE_MAP = {
    standard: { prefix: 'M500', ext: '.mp3' }, // 128k
    exhigh:   { prefix: 'M800', ext: '.mp3' }, // 320k
    lossless: { prefix: 'F000', ext: '.flac' },// 无损 FLAC
};

// 兼容播放器的音源请求路径 /music/qq_song_kw.php
app.get('/music/qq_song_kw.php', async (req, res) => {
    const songmid = req.query.id;
    const level = req.query.level || 'standard';

    if (!songmid) return res.status(400).json({ code: 400, msg: '缺少 songmid' });

    const { prefix, ext } = FILE_MAP[level] || FILE_MAP.standard;
    const filename = `${prefix}${songmid}${ext}`;
    const guid = Math.floor(Math.random() * 1000000000).toString();

    const payload = {
        req_1: {
            module: 'vkey.GetVkey',
            method: 'CgiGetVkey',
            param: {
                guid: guid,
                songmid: [songmid],
                filename: [filename],
                songtype: [0],
                uin: '0',
                loginflag: 1,
                platform: '20'
            }
        }
    };

    try {
        const response = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', payload, {
            headers: {
                'Referer': 'https://y.qq.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const data = response.data?.req_1?.data;
        const purl = data?.midurlinfo?.[0]?.purl;
        const sip = data?.sip?.[0] || 'https://dl.stream.qqmusic.qq.com/';

        if (purl) {
            return res.json({
                code: 200,
                data: { url: sip + purl }
            });
        } else {
            return res.status(404).json({ code: 404, msg: '暂无播放权限或需要VIP' });
        }
    } catch (err) {
        return res.status(500).json({ code: 500, msg: '请求解析失败', error: err.message });
    }
});

// 健康检查路由
app.get('/', (req, res) => {
    res.send('Music API is running smoothly on Alwaysdata!');
});

// Alwaysdata 专属监听配置（优先使用系统传入的环境变量）
const PORT = process.env.PORT || 8100;
const IP   = process.env.IP || '::';
app.listen(PORT, IP, () => {
    console.log(`Server running on ${IP}:${PORT}`);
});
