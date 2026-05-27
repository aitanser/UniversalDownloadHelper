// ==UserScript==
// @name         全能下载助手 | 网盘+Openlist+AList+WebOS (内嵌版)
// @namespace    https://github.com/aitanser/universal-download-helper
// @version      1.0.0
// @author       aitanser
// @description  自动捕获30+网盘直链；主动获取百度、阿里、天翼、迅雷、夸克、移动六大网盘直链；支持浏览器/IDM下载、Aria2/cURL命令、BC链接、RPC推送（适配Motrix Next）。界面内嵌悬浮按钮+模态框。
// @license      MIT
// @supportURL   https://github.com/aitanser/universal-download-helper/issues
// @homepageURL  https://github.com/aitanser/universal-download-helper
// @updateURL    https://raw.githubusercontent.com/aitanser/universal-download-helper/main/universal-download-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/aitanser/universal-download-helper/main/universal-download-helper.user.js
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?domain=greasyfork.org
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_cookie
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ---------- 配置模块 ----------
    const CONFIG = {
        version: '1.0.0',
        themeColor: '#09AAFF',
        debug: true,
        maxConcurrent: 3,
        apiPatterns: [
            '/api/download', '/api/sharedownload', '/share/download',
            '/v2/file/download', '/v2/share_link/download',
            '/api/v1/file/download', '/api/v2/file/download',
            '/drive/v1/files', '/hcy/file/download',
            '/orchestration/personalCloud/catalog/v1.0/getDisk',
            '/d/', '/down/', '115.com', 'ctfile.com', 'weiyun.com', 'lanzou',
            'yunpan.360.cn', '/f/', 'uc.cn',
            '/api/fs/get', '/api/fs/list', '/api/public/path', '/api/me',
            '/api/public/link', '/api/disk/manage'
        ],
        urlKeys: ['url','download_url','dlink','downloadUrl','link','downurl','web_content_link','downloadURL','urls','real_url','data','raw_url','src'],
        rpc: { domain: 'http://localhost', port: '16800', path: '/jsonrpc', token: '', dir: 'D:/Downloads' },
        supportedDomains: [
            'pan.baidu.com', 'yun.baidu.com', 'www.aliyundrive.com', 'www.alipan.com',
            'cloud.189.cn', 'pan.xunlei.com', 'pan.quark.cn', 'yun.139.com', 'caiyun.139.com',
            'www.123pan.com', 'feijipan.com', 'www.feijipan.com', '115.com', 'ctfile.com',
            'weiyun.com', 'lanzou.com', 'lanzoux.com', 'lanzoui.com', 'lanzous.com', 'lanzouh.com',
            'yunpan.360.cn', 'ws28.cn', 'uc.cn', 'drive.uc.cn'
        ]
    };

    // ---------- 状态模块 ----------
    const state = {
        capturedFiles: [],
        isCapturing: true,
        interceptorInstalled: false,
        currentMode: 'api',
        rpcConfig: { ...CONFIG.rpc },
        activePan: null,
        modalVisible: false,
        floatingBtn: null,
        modal: null
    };

    // ---------- 工具函数 ----------
    const log = (...args) => CONFIG.debug && console.log('[全能助手]', ...args);
    const warn = (...args) => CONFIG.debug && console.warn('[全能助手]', ...args);
    const error = (...args) => CONFIG.debug && console.error('[全能助手]', ...args);

    function showToast(message, bgColor = '#333', duration = 2000) {
        let toast = document.getElementById('ud-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ud-toast';
            toast.style.cssText = `
                position:fixed; bottom:30px; right:30px; background:${bgColor}; color:#fff;
                padding:10px 20px; border-radius:8px; font-size:14px; z-index:10001;
                transition:opacity 0.3s; pointer-events:none;
            `;
            document.body.appendChild(toast);
        }
        toast.style.backgroundColor = bgColor;
        toast.textContent = message;
        toast.style.opacity = '1';
        clearTimeout(window.toastTimeout);
        window.toastTimeout = setTimeout(() => toast.style.opacity = '0', duration);
    }

    function getReferer() { return location.href; }

    function extractFilenameFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname.split('/').pop();
            return decodeURIComponent(path.split('?')[0]) || 'file';
        } catch(e) { return 'file'; }
    }

    function sanitizeFilename(name) {
        return name.replace(/[\\/:*?"<>|]/g, '_');
    }

    function loadSettings() {
        try {
            const saved = GM_getValue('capturedFiles', null);
            if (saved) state.capturedFiles = JSON.parse(saved);
            const savedRpc = GM_getValue('rpcConfig', null);
            if (savedRpc) Object.assign(state.rpcConfig, JSON.parse(savedRpc));
            const savedColor = GM_getValue('themeColor', null);
            if (savedColor) CONFIG.themeColor = savedColor;
        } catch(e) { warn('加载设置失败', e); }
        updateLinkCount();
    }

    function saveCapturedFiles() {
        try { GM_setValue('capturedFiles', JSON.stringify(state.capturedFiles)); } catch(e) { warn('保存失败', e); }
    }

    function saveRpcConfig() {
        try { GM_setValue('rpcConfig', JSON.stringify(state.rpcConfig)); } catch(e) { warn('保存RPC失败', e); }
    }

    // ---------- 页面特征检测 ----------
    function detectPanType() {
        const host = location.hostname;
        if (/pan\.baidu\.com|yun\.baidu\.com/.test(host)) return 'baidu';
        if (/aliyundrive\.com|alipan\.com/.test(host)) return 'ali';
        if (/cloud\.189\.cn/.test(host)) return 'tianyi';
        if (/pan\.xunlei\.com/.test(host)) return 'xunlei';
        if (/pan\.quark\.cn/.test(host)) return 'quark';
        if (/yun\.139\.com|caiyun\.139\.com/.test(host)) return 'yidong';
        if (/www\.123pan\.com/.test(host)) return '123pan';
        if (/lanzou[a-z]*\.(com|cn|net)/.test(host)) return 'lanzou';
        if (/drive\.uc\.cn|pan\.uc\.cn/.test(host)) return 'uc';
        if (/115\.com/.test(host)) return '115';
        return null;
    }

    function isSupportedPage() {
        const host = location.hostname;
        if (CONFIG.supportedDomains.some(d => host === d || host.endsWith('.' + d))) return true;
        if (/Index of \/|目录列表|Directory listing|文件列表/i.test(document.title)) return true;
        const h1 = document.querySelector('h1');
        if (h1 && /index of|目录列表|directory listing/i.test(h1.textContent)) return true;
        const table = document.querySelector('table');
        if (table) {
            const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.toLowerCase());
            if (headers.some(h => /name|file|last modified/i.test(h))) return true;
        }
        const pre = document.querySelector('pre');
        if (pre && pre.querySelectorAll('a[href]').length > 3) return true;
        if (document.querySelector('.filelist, #files, [class*="file-list"], [class*="directory-listing"]')) return true;
        if (document.querySelector('#app') && (document.querySelector('[class*="hope"]') || document.querySelector('.hope-ui-dark'))) return true;
        const generator = document.querySelector('meta[name="generator"]');
        if (generator && /alist/i.test(generator.content)) return true;
        if (window.AList || window.AListConfig) return true;
        if (document.querySelector('[class*="start"], [class*="taskbar"], [class*="win11"], [class*="this-pc"]')) return true;
        const title = document.querySelector('title');
        if (title && /腾飞|webos|私有云/i.test(title.textContent)) return true;
        if (document.querySelector('meta[name="generator"]')?.content.match(/腾飞|webos/i)) return true;
        return false;
    }

    function isOpenlistPage() {
        return /Index of \/|目录列表/i.test(document.title) ||
               (document.querySelector('h1') && /index of/i.test(document.querySelector('h1').textContent)) ||
               (document.querySelector('pre') && document.querySelectorAll('pre a[href]').length > 3);
    }

    // ---------- 链接管理 ----------
    function addCapturedFile(url, filename = '', referer = '', size = '') {
        if (!url || !url.startsWith('http')) return false;
        if (state.capturedFiles.some(f => f.url === url)) return false;
        if (!filename) filename = extractFilenameFromUrl(url);
        state.capturedFiles.push({ url, filename, referer, size });
        saveCapturedFiles();
        updateLinkCount();
        log('捕获:', filename, url);
        showToast(`✓ 已捕获: ${filename.substring(0, 30)}`, '#4CAF50');
        return true;
    }

    function removeFile(index) {
        if (index >= 0 && index < state.capturedFiles.length) {
            const removed = state.capturedFiles.splice(index, 1)[0];
            saveCapturedFiles();
            updateLinkCount();
            showToast(`已移除: ${removed.filename}`, '#f44336');
            if (state.modalVisible && state.modal) refreshModalContent();
        }
    }

    function clearAll() {
        state.capturedFiles = [];
        saveCapturedFiles();
        updateLinkCount();
        showToast('已清空所有链接', '#f44336');
        if (state.modalVisible && state.modal) refreshModalContent();
    }

    function updateLinkCount() {
        const cnt = state.capturedFiles.length;
        const badge = document.getElementById('ud-badge');
        if (badge) badge.textContent = cnt;
        if (state.modalVisible && state.modal) refreshModalContent();
    }

    // ---------- 蓝奏云解析 ----------
    async function parseLanzou(shareUrl, pwd = '', retry = 0) {
        const MAX_RETRY = 2;
        try {
            let url = shareUrl.trim();
            if (!url.startsWith('http')) url = 'https://' + url;
            const urlObj = new URL(url);
            let baseDomain = urlObj.hostname;

            const getHtml = (u) => new Promise(r => {
                GM_xmlhttpRequest({
                    method: 'GET', url: u,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    onload: res => r(res.responseText),
                    onerror: () => r(null),
                    timeout: 10000
                });
            });

            let html = await getHtml(url);
            if (!html) {
                if (retry < MAX_RETRY) return parseLanzou(shareUrl, pwd, retry + 1);
                return null;
            }

            let sign = (html.match(/var skdklds\s*=\s*'([^']+)'/) || [])[1] ||
                       (html.match(/var\s+sign\s*=\s*'([^']+)'/) || [])[1] ||
                       (html.match(/sign\s*:\s*'([^']+)'/) || [])[1] || '';
            let pwdParam = pwd || (html.match(/var\s+pwd\s*=\s*'([^']+)'/) || [])[1] || '';

            const postData = new URLSearchParams();
            postData.append('action', 'downprocess');
            postData.append('sign', sign);
            if (pwdParam) postData.append('p', pwdParam);
            const kMatch = html.match(/k\s*:\s*'([^']+)'/);
            if (kMatch) postData.append('k', kMatch[1]);

            const ajaxUrl = `https://${baseDomain}/ajaxm.php`;
            const resp = await new Promise(r => {
                GM_xmlhttpRequest({
                    method: 'POST', url: ajaxUrl,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    data: postData.toString(),
                    onload: res => { try { r(JSON.parse(res.responseText)); } catch(e) { r(null); } },
                    onerror: () => r(null),
                    timeout: 10000
                });
            });

            if (resp && resp.zt === 1) {
                let dom = resp.dom, fileUrl = resp.url;
                if (dom && fileUrl) {
                    return `https://${dom}/file/${fileUrl}` + (resp.inf?.t ? `?t=${resp.inf.t}` : '');
                }
                if (resp.url) return resp.url;
            }
            const folderMatch = html.match(/data\s*:\s*(\{.*?\})/s);
            if (folderMatch) {
                try {
                    const folderData = JSON.parse(folderMatch[1]);
                    if (folderData?.text?.length) {
                        const firstFile = folderData.text[0];
                        return await parseLanzou(`https://${baseDomain}/${firstFile.id}`, pwdParam);
                    }
                } catch(e) {}
            }
            return null;
        } catch(e) {
            error('蓝奏云解析异常', e);
            if (retry < MAX_RETRY) return parseLanzou(shareUrl, pwd, retry + 1);
            return null;
        }
    }

    // ---------- 链接扫描 ----------
    function scanOpenlistLinks() {
        if (!isOpenlistPage()) { showToast('非Openlist页面', '#ff9800'); return; }
        const links = document.querySelectorAll('a[href]');
        const base = location.href;
        let cnt = 0;
        links.forEach(a => {
            const href = a.getAttribute('href');
            if (!href || href === '../' || href === './' || href === '/' || href.startsWith('?')) return;
            try {
                const full = new URL(href, base).href;
                if (full.endsWith('/')) return;
                const fname = a.textContent.trim() || extractFilenameFromUrl(full);
                if (addCapturedFile(full, decodeURIComponent(fname), location.href)) cnt++;
            } catch(e) {}
        });
        showToast(cnt ? `已捕获 ${cnt} 个文件` : '未发现新链接', cnt ? '#4CAF50' : '#ff9800');
    }

    function scanPageLinks() {
        const selectors = [
            'a[href*="/d/"]', 'a[href*="/file/"]', 'a[href*="/download"]',
            '[data-url]', '[data-raw-url]', '[data-download-url]', '[data-link]', '[data-clipboard-text]'
        ];
        let cnt = 0;
        document.querySelectorAll(selectors.join(',')).forEach(el => {
            const url = el.href || el.getAttribute('data-url') || el.getAttribute('data-raw-url') ||
                        el.getAttribute('data-download-url') || el.getAttribute('data-link') || el.getAttribute('data-clipboard-text');
            if (url && url.startsWith('http') && !state.capturedFiles.some(f => f.url === url)) {
                const fname = el.textContent.trim() || el.getAttribute('data-filename') || extractFilenameFromUrl(url);
                if (addCapturedFile(url, fname, location.href)) cnt++;
            }
        });
        showToast(cnt ? `扫描到 ${cnt} 个链接` : '未发现新链接', cnt ? '#4CAF50' : '#ff9800');
    }

    // ---------- 批量导入 ----------
    function batchImportLinks() {
        const dlg = document.createElement('div');
        dlg.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:#fff;color:#333;padding:20px;border-radius:12px;z-index:10002;box-shadow:0 0 20px rgba(0,0,0,0.2);width:500px;';
        dlg.innerHTML = `
            <h3 style="margin-top:0; color:${CONFIG.themeColor};">批量导入链接</h3>
            <p style="font-size:12px;color:#666;">每行一个链接，可附带文件名（空格或制表符分隔）</p>
            <textarea id="ud-batch-textarea" style="width:100%;height:200px;background:#fafafa;color:#333;border:1px solid #ddd;border-radius:6px;padding:8px;font-family:monospace;resize:vertical;" placeholder="https://..."></textarea>
            <div style="margin-top:15px;text-align:right;">
                <button id="ud-batch-import-confirm" style="background:${CONFIG.themeColor};border:none;color:#fff;padding:6px 16px;border-radius:6px;margin-right:8px;">导入</button>
                <button id="ud-batch-import-cancel" style="background:#f44336;border:none;color:#fff;padding:6px 16px;border-radius:6px;">取消</button>
            </div>
        `;
        document.body.appendChild(dlg);
        dlg.querySelector('#ud-batch-import-cancel').onclick = () => dlg.remove();
        dlg.querySelector('#ud-batch-import-confirm').onclick = () => {
            const raw = dlg.querySelector('#ud-batch-textarea').value;
            const lines = raw.split('\n');
            let added = 0;
            lines.forEach(line => {
                line = line.trim();
                if (!line || !line.startsWith('http')) return;
                const parts = line.split(/\s+/);
                const url = parts[0];
                const filename = parts.slice(1).join(' ') || '';
                if (addCapturedFile(url, filename, getReferer())) added++;
            });
            showToast(`成功导入 ${added} 条链接`, '#4CAF50');
            dlg.remove();
        };
    }

    function manualAddLink() {
        const url = prompt('请输入文件直链 (http/https):');
        if (!url) return;
        const filename = prompt('请输入文件名 (可选):', extractFilenameFromUrl(url));
        addCapturedFile(url, filename || '', location.href);
    }

    // ---------- 导出与RPC ----------
    function toAria2Command(f) {
        return `aria2c "${f.url}" --out "${sanitizeFilename(f.filename)}"` + (f.referer ? ` --header "Referer: ${f.referer}"` : '');
    }
    function toCurlCommand(f) {
        return `curl -L -C - "${f.url}" -o "${sanitizeFilename(f.filename)}"` + (f.referer ? ` -e "${f.referer}"` : '');
    }
    function toBCLink(f) {
        let enc = encodeURIComponent(f.filename);
        let data = `AA/${enc}/?url=${encodeURIComponent(f.url)}`;
        if (f.referer) data += `&refer=${encodeURIComponent(f.referer)}`;
        data += 'ZZ';
        return `bc://http/${btoa(unescape(encodeURIComponent(data)))}`;
    }

    async function sendToRPC(file) {
        const { domain, port, path, token, dir } = state.rpcConfig;
        const url = `${domain}:${port}${path}`;
        let headers = [];
        if (file.referer) headers.push(`Referer: ${file.referer}`);
        if (state.activePan === 'baidu') {
            const bduss = await getBaiduBDUSS();
            if (bduss) headers.push(`Cookie: BDUSS=${bduss}`);
            headers.push(`User-Agent: netdisk`);
        } else if (state.activePan === 'ali') {
            headers.push(`Referer: https://www.aliyundrive.com/`);
        } else if (state.activePan === 'quark') {
            headers.push(`Cookie: ${document.cookie}`);
        }
        const payload = {
            id: Date.now() + Math.random(),
            jsonrpc: '2.0',
            method: 'aria2.addUri',
            params: [`token:${token}`, [file.url], {
                dir: dir,
                out: file.filename,
                header: headers
            }]
        };
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST', url, headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(payload),
                onload: res => { try { resolve(!!JSON.parse(res.response).result); } catch(e) { resolve(false); } },
                onerror: () => resolve(false),
                timeout: 15000
            });
        });
    }

    async function batchSendToRPC() {
        if (!state.capturedFiles.length) { showToast('列表为空', '#ff9800'); return; }
        const total = state.capturedFiles.length;
        let success = 0, failed = 0;
        showToast(`开始批量推送 ${total} 个任务`, '#2196F3');

        const queue = [...state.capturedFiles];
        const workers = Array(CONFIG.maxConcurrent).fill().map(async () => {
            while (queue.length) {
                const file = queue.shift();
                const ok = await sendToRPC(file);
                if (ok) success++; else failed++;
            }
        });
        await Promise.all(workers);
        showToast(`批量推送完成：成功 ${success}，失败 ${failed}`, success === total ? '#4CAF50' : '#ff9800');
    }

    function directDownload(file) {
        const a = document.createElement('a');
        a.href = file.url;
        a.download = file.filename;
        a.click();
    }

    // ========== 网盘主动获取核心模块 ==========
    async function getBaiduBDUSS() {
        if (typeof GM_cookie !== 'undefined') {
            return new Promise(resolve => {
                GM_cookie('list', {name: 'BDUSS', url: location.origin}, (cookies) => {
                    resolve(cookies?.[0]?.value || '');
                });
            });
        } else {
            const match = document.cookie.match(/BDUSS=([^;]+)/);
            return match ? match[1] : '';
        }
    }

    function getBaiduSelectedFiles() {
        try {
            if (document.querySelector('.wp-s-core-pan')) {
                const vue = document.querySelector('.wp-s-core-pan').__vue__;
                if (vue && vue.selectedList) {
                    return vue.selectedList.filter(f => f.isdir === 0);
                }
            }
            if (window.require) {
                const context = require('system-core:context/context.js').instanceForSystem;
                return context.list.getSelected().filter(f => f.isdir === 0);
            }
        } catch(e) { error('百度网盘获取选中项失败', e); }
        return [];
    }

    function getBdstoken() {
        const match = document.cookie.match(/bdstoken=([^;]+)/);
        return match ? match[1] : '';
    }

    async function fetchBaiduLinks() {
        const isShare = /^\/(s|share)\//.test(location.pathname);
        if (isShare) {
            showToast('百度分享页请先转存到自己的网盘，再在主页勾选下载', '#ff9800', 4000);
            return [];
        }
        const selected = getBaiduSelectedFiles();
        if (!selected.length) throw new Error('请先勾选文件');
        const bduss = await getBaiduBDUSS();
        if (!bduss) throw new Error('未登录百度账号');
        const fidlist = selected.map(f => f.fs_id);
        const bdstoken = getBdstoken();
        const url = `https://pan.baidu.com/api/download?app_id=250528&channel=chunlei&clienttype=0&web=1&fidlist=${JSON.stringify(fidlist)}&bdstoken=${bdstoken}`;
        const resp = await fetch(url, { headers: { 'Cookie': `BDUSS=${bduss}` } }).then(r => r.json());
        if (resp.errno !== 0) throw new Error(resp.errmsg || '获取失败');
        const files = [];
        for (let item of resp.list) {
            if (item.dlink) {
                files.push({ url: item.dlink, filename: item.server_filename, size: formatSize(item.size) });
            }
        }
        return files;
    }

    function getAliToken() {
        const token = localStorage.getItem('token');
        return token ? JSON.parse(token).access_token : '';
    }

    function getAliSelectedFiles() {
        try {
            const listDom = document.querySelector('[class*="list"]');
            if (!listDom) return [];
            const key = Object.keys(listDom).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (!key) return [];
            const fiber = listDom[key];
            let props = fiber.pendingProps;
            if (!props) return [];
            const dataSource = props.dataSource || [];
            const selectedKeys = props.selectedKeys ? props.selectedKeys.split(',') : [];
            return dataSource.filter(f => selectedKeys.includes(f.file_id) && f.type === 'file');
        } catch(e) { error('阿里云盘获取选中项失败', e); }
        return [];
    }

    async function fetchAliLinks() {
        const isShare = /^\/(s|share)\//.test(location.pathname);
        if (isShare) {
            showToast('阿里分享页请先转存到网盘，再在主页勾选下载', '#ff9800', 4000);
            return [];
        }
        const selected = getAliSelectedFiles();
        if (!selected.length) throw new Error('请先勾选文件');
        const token = getAliToken();
        if (!token) throw new Error('未登录阿里云盘');
        const tasks = selected.map(file => async () => {
            const resp = await fetch('https://api.aliyundrive.com/v2/file/get_download_url', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ drive_id: file.drive_id, file_id: file.file_id })
            }).then(r => r.json());
            if (resp.url) return { url: resp.url, filename: file.name, size: formatSize(file.size) };
            return null;
        });
        const results = await Promise.all(tasks.map(t => t()));
        return results.filter(Boolean);
    }

    function getTianyiToken() {
        return localStorage.getItem('accessToken') || '';
    }

    function getTianyiSelectedFiles() {
        try {
            if (document.querySelector('.c-file-list')?.__vue__) {
                const vue = document.querySelector('.c-file-list').__vue__;
                return vue.selectedList.filter(f => !f.isFolder);
            }
            if (document.querySelector('.info-detail')?.__vue__) {
                const detail = document.querySelector('.info-detail').__vue__.fileDetail;
                return detail && !detail.isFolder ? [detail] : [];
            }
        } catch(e) { error('天翼云盘获取选中项失败', e); }
        return [];
    }

    async function fetchTianyiLinks() {
        const selected = getTianyiSelectedFiles();
        if (!selected.length) throw new Error('请先勾选文件');
        const token = getTianyiToken();
        if (!token) throw new Error('未登录天翼云盘');
        const tasks = selected.map(file => async () => {
            const resp = await fetch(`https://cloud.189.cn/api/open/file/getFileDownloadUrl.action?fileId=${file.fileId}`, {
                headers: { 'Accept': 'application/json', 'AccessToken': token }
            }).then(r => r.json());
            if (resp.fileDownloadUrl) return { url: resp.fileDownloadUrl, filename: file.fileName, size: formatSize(file.size) };
            return null;
        });
        const results = await Promise.all(tasks.map(t => t()));
        return results.filter(Boolean);
    }

    function getXunleiToken() {
        for (let i=0; i<localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('credentials_')) return JSON.parse(localStorage.getItem(key));
        }
        return null;
    }

    function getXunleiSelectedFiles() {
        try {
            const items = document.querySelectorAll('.SourceListItem__item--XxpOC');
            const selected = [];
            items.forEach(el => {
                const vue = el.__vue__;
                if (vue && vue.selected && vue.selected.includes(vue.info.id) && vue.info.kind === 'drive#file') {
                    selected.push(vue.info);
                }
            });
            return selected;
        } catch(e) { error('迅雷云盘获取选中项失败', e); }
        return [];
    }

    async function fetchXunleiLinks() {
        const isShare = /^\/(s|share)\//.test(location.pathname);
        if (isShare) {
            showToast('迅雷分享页请先转存到网盘，再在主页勾选下载', '#ff9800', 4000);
            return [];
        }
        const selected = getXunleiSelectedFiles();
        if (!selected.length) throw new Error('请先勾选文件');
        const token = getXunleiToken();
        if (!token) throw new Error('未登录迅雷云盘');
        const tasks = selected.map(file => async () => {
            const resp = await fetch(`https://pan.xunlei.com/rest/pan/xdrive/file?file_id=${file.id}`, {
                headers: { 'Authorization': `${token.token_type} ${token.access_token}` }
            }).then(r => r.json());
            if (resp.web_content_link) return { url: resp.web_content_link, filename: file.name, size: formatSize(file.size) };
            return null;
        });
        const results = await Promise.all(tasks.map(t => t()));
        return results.filter(Boolean);
    }

    function getQuarkSelectedFiles() {
        try {
            const listDom = document.querySelector('.file-list');
            if (!listDom) return [];
            const key = Object.keys(listDom).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (!key) return [];
            const fiber = listDom[key];
            let props = fiber.pendingProps || fiber.memoizedProps;
            if (!props) return [];
            const fileList = props.list || [];
            const selectedKeys = props.selectedRowKeys || [];
            return fileList.filter(f => selectedKeys.includes(f.fid) && f.file === true);
        } catch(e) { error('夸克网盘获取选中项失败', e); }
        return [];
    }

    async function fetchQuarkLinks() {
        const isShare = /^\/(s|share)\//.test(location.pathname);
        if (isShare) {
            showToast('夸克分享页请先转存到网盘，再在主页勾选下载', '#ff9800', 4000);
            return [];
        }
        const selected = getQuarkSelectedFiles();
        if (!selected.length) throw new Error('请先勾选文件');
        const fids = selected.map(f => f.fid);
        const resp = await fetch('https://pan.quark.cn/1/clouddrive/file/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fids })
        }).then(r => r.json());
        if (resp.code !== 0) throw new Error(resp.message || '获取失败');
        const files = [];
        for (let item of resp.data) {
            if (item.download_url) {
                files.push({ url: item.download_url, filename: item.file_name, size: formatSize(item.size) });
            }
        }
        return files;
    }

    function getYidongSelectedFiles() {
        try {
            if (document.querySelector('.main_file_list')?.__vue__) {
                const vue = document.querySelector('.main_file_list').__vue__;
                return vue.selectList.map(v => v.item).filter(f => f.fileEtag || f.coName);
            }
            if (document.querySelector('.home-page')?.__vue__) {
                const vue = document.querySelector('.home-page').__vue__;
                const fileList = vue._computedWatchers.fileList.value || [];
                const dirList = vue._computedWatchers.dirList.value || [];
                const selectedFile = vue.selectedFile || [];
                const selectedDir = vue.selectedDir || [];
                const files = fileList.filter((v, i) => selectedFile.includes(i));
                const dirs = dirList.filter((v, i) => selectedDir.includes(i));
                return [...files, ...dirs].filter(f => f.fileEtag || f.coName);
            }
        } catch(e) { error('移动云盘获取选中项失败', e); }
        return [];
    }

    async function fetchYidongLinks() {
        const selected = getYidongSelectedFiles();
        if (!selected.length) throw new Error('请先勾选文件');
        const tasks = selected.map(file => async () => {
            const resp = await fetch('https://yun.139.com/orchestration/personalCloud/catalog/v1.0/getDisk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contentID: file.contentID || file.id })
            }).then(r => r.json());
            if (resp.data?.downloadURL) return { url: resp.data.downloadURL, filename: file.contentName || file.name, size: formatSize(file.contentSize || file.size) };
            return null;
        });
        const results = await Promise.all(tasks.map(t => t()));
        return results.filter(Boolean);
    }

    async function fetchLanzouLinks() {
        const direct = await parseLanzou(location.href);
        return direct ? [{ url: direct, filename: extractFilenameFromUrl(direct) }] : [];
    }

    function formatSize(bytes) {
        if (!bytes) return '';
        const units = ['B','KB','MB','GB','TB'];
        let i = 0;
        let size = bytes;
        while (size >= 1024 && i < units.length-1) { size /= 1024; i++; }
        return size.toFixed(1) + units[i];
    }

    async function fetchPanLinks() {
        const panType = detectPanType();
        if (!panType) {
            showToast('当前页面非已知网盘', '#ff9800');
            return;
        }
        state.activePan = panType;
        showToast(`正在获取 ${panType} 直链...`, '#2196F3');

        try {
            let files = [];
            switch(panType) {
                case 'baidu': files = await fetchBaiduLinks(); break;
                case 'ali': files = await fetchAliLinks(); break;
                case 'tianyi': files = await fetchTianyiLinks(); break;
                case 'xunlei': files = await fetchXunleiLinks(); break;
                case 'quark': files = await fetchQuarkLinks(); break;
                case 'yidong': files = await fetchYidongLinks(); break;
                case 'lanzou': files = await fetchLanzouLinks(); break;
                default: showToast('该网盘主动获取暂未支持，请使用通用捕获', '#ff9800'); return;
            }
            if (files.length === 0) {
                showToast('未获取到任何文件，请确认已选中或页面正确', '#ff9800');
                return;
            }
            files.forEach(f => addCapturedFile(f.url, f.filename, getReferer(), f.size));
            showToast(`成功获取 ${files.length} 个直链`, '#4CAF50');
        } catch(e) {
            error('获取网盘直链失败', e);
            showToast(e.message || '获取失败，请刷新或检查登录状态', '#f44336');
        }
    }

    // ========== UI：悬浮按钮 + 模态框 ==========
    function createFloatingButton() {
        if (document.getElementById('ud-floating-btn')) return;
        const btn = document.createElement('div');
        btn.id = 'ud-floating-btn';
        btn.innerHTML = `
            <div style="position:relative;">
                <span style="font-size:24px;">⚡</span>
                <span id="ud-badge" style="position:absolute; top:-8px; right:-8px; background:${CONFIG.themeColor}; color:#fff; border-radius:10px; padding:2px 6px; font-size:10px; font-weight:bold;">0</span>
            </div>
        `;
        btn.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            width: 56px;
            height: 56px;
            background: ${CONFIG.themeColor};
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            cursor: pointer;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s;
            user-select: none;
        `;
        btn.onmouseenter = () => btn.style.transform = 'scale(1.05)';
        btn.onmouseleave = () => btn.style.transform = 'scale(1)';
        btn.onclick = () => toggleModal();
        document.body.appendChild(btn);
        state.floatingBtn = btn;

        // 拖拽移动悬浮按钮
        let drag = false, startX, startY, startLeft, startBottom;
        btn.onmousedown = (e) => {
            if (e.target === btn || btn.contains(e.target)) {
                drag = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = btn.getBoundingClientRect();
                startLeft = rect.left;
                startBottom = window.innerHeight - rect.bottom;
                btn.style.transition = 'none';
                e.preventDefault();
            }
        };
        window.onmousemove = (e) => {
            if (!drag) return;
            let left = startLeft + (e.clientX - startX);
            let bottom = startBottom - (e.clientY - startY);
            left = Math.min(Math.max(0, left), window.innerWidth - btn.offsetWidth);
            bottom = Math.min(Math.max(0, bottom), window.innerHeight - btn.offsetHeight);
            btn.style.left = left + 'px';
            btn.style.bottom = bottom + 'px';
            btn.style.right = 'auto';
            btn.style.top = 'auto';
        };
        window.onmouseup = () => {
            if (drag) {
                drag = false;
                btn.style.transition = '';
                GM_setValue('btnLeft', btn.style.left);
                GM_setValue('btnBottom', btn.style.bottom);
            }
        };
        // 恢复位置
        const savedLeft = GM_getValue('btnLeft');
        const savedBottom = GM_getValue('btnBottom');
        if (savedLeft && savedBottom) {
            btn.style.left = savedLeft;
            btn.style.bottom = savedBottom;
            btn.style.right = 'auto';
        }
    }

    function createModal() {
        if (state.modal) state.modal.remove();
        const modalDiv = document.createElement('div');
        modalDiv.id = 'ud-modal';
        modalDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.95);
            width: 700px;
            max-width: 90vw;
            background: rgba(30,30,35,0.98);
            backdrop-filter: blur(12px);
            border-radius: 24px;
            box-shadow: 0 20px 35px rgba(0,0,0,0.3);
            z-index: 10020;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            transition: transform 0.2s, opacity 0.2s;
            opacity: 0;
            display: none;
        `;
        modalDiv.innerHTML = `
            <div id="modal-drag-handle" style="cursor:move; padding:16px 20px; border-bottom:1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:18px; font-weight:600; color:${CONFIG.themeColor};">⚡ 全能下载助手 v${CONFIG.version}</span>
                <button id="modal-close" style="background:none; border:none; color:#aaa; font-size:24px; cursor:pointer;">&times;</button>
            </div>
            <div class="ud-modal-content" style="padding:20px;"></div>
        `;
        document.body.appendChild(modalDiv);
        state.modal = modalDiv;

        // 拖拽模态框
        const dragHandle = modalDiv.querySelector('#modal-drag-handle');
        let isDragging = false, startX, startY, startLeft, startTop;
        dragHandle.addEventListener('mousedown', (e) => {
            if (e.target === dragHandle || dragHandle.contains(e.target)) {
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = modalDiv.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;
                modalDiv.style.transition = 'none';
                e.preventDefault();
            }
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let left = startLeft + (e.clientX - startX);
            let top = startTop + (e.clientY - startY);
            left = Math.min(Math.max(0, left), window.innerWidth - modalDiv.offsetWidth);
            top = Math.min(Math.max(0, top), window.innerHeight - modalDiv.offsetHeight);
            modalDiv.style.left = left + 'px';
            modalDiv.style.top = top + 'px';
            modalDiv.style.transform = 'none';
        });
        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                modalDiv.style.transition = '';
            }
        });
        modalDiv.querySelector('#modal-close').onclick = () => toggleModal(false);
    }

    function getModeName(mode) {
        const names = { api: '🌐 直接下载', aria: '⬇️ Aria2 命令', curl: '📜 cURL 命令', bc: '🐿️ BC 链接', rpc: '🚀 RPC 推送' };
        return names[mode] || '选择模式';
    }

    function refreshModalContent() {
        if (!state.modal || !state.modalVisible) return;
        const contentDiv = state.modal.querySelector('.ud-modal-content');
        const files = state.capturedFiles;
        const mode = state.currentMode;
        let html = `
            <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:12px;">
                <div class="ud-dropdown" style="position:relative;">
                    <button id="modal-mode-btn" style="background:${CONFIG.themeColor}; border:none; color:#fff; padding:6px 12px; border-radius:20px; cursor:pointer;">${getModeName(mode)} ▼</button>
                    <div id="modal-mode-menu" style="position:absolute; top:100%; left:0; background:#2a2a2e; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.3); display:none; z-index:100;">
                        <div data-mode="api" class="mode-item" style="padding:8px 16px; cursor:pointer;">🌐 直接下载</div>
                        <div data-mode="aria" class="mode-item" style="padding:8px 16px; cursor:pointer;">⬇️ Aria2 命令</div>
                        <div data-mode="curl" class="mode-item" style="padding:8px 16px; cursor:pointer;">📜 cURL 命令</div>
                        <div data-mode="bc" class="mode-item" style="padding:8px 16px; cursor:pointer;">🐿️ BC 链接</div>
                        <div data-mode="rpc" class="mode-item" style="padding:8px 16px; cursor:pointer;">🚀 RPC 推送</div>
                    </div>
                </div>
                <button id="modal-scan" style="background:#444; border:none; color:#fff; padding:6px 12px; border-radius:20px; cursor:pointer;">🔍 扫描页面</button>
                <button id="modal-fetch" style="background:#444; border:none; color:#fff; padding:6px 12px; border-radius:20px; cursor:pointer;">📥 获取网盘</button>
                <button id="modal-settings" style="background:#444; border:none; color:#fff; padding:6px 12px; border-radius:20px; cursor:pointer;">⚙️ RPC设置</button>
            </div>
            <div id="modal-file-list" style="max-height:400px; overflow-y:auto; margin-bottom:16px;">
        `;
        if (files.length === 0) {
            html += '<div style="text-align:center; color:#aaa; padding:20px;">暂无捕获的链接</div>';
        } else {
            files.forEach((f, i) => {
                const sizeDisplay = f.size ? `<span style="color:#f56c6c; margin-left:6px;">${f.size}</span>` : '';
                let actions = '';
                if (mode === 'api') {
                    actions = `<button class="action-btn" data-action="download" data-index="${i}" style="background:#555; border:none; color:#fff; padding:4px 8px; border-radius:16px; cursor:pointer;">⬇️下载</button>
                               <button class="action-btn" data-action="copy-link" data-index="${i}" style="background:#555; border:none; color:#fff; padding:4px 8px; border-radius:16px; cursor:pointer;">📋复制</button>`;
                } else if (mode === 'aria') {
                    actions = `<button class="action-btn" data-action="copy" data-type="aria" data-index="${i}" style="background:#555; border:none; color:#fff; padding:4px 8px; border-radius:16px; cursor:pointer;">📋复制命令</button>`;
                } else if (mode === 'curl') {
                    actions = `<button class="action-btn" data-action="copy" data-type="curl" data-index="${i}" style="background:#555; border:none; color:#fff; padding:4px 8px; border-radius:16px; cursor:pointer;">📋复制命令</button>`;
                } else if (mode === 'bc') {
                    actions = `<button class="action-btn" data-action="copy" data-type="bc" data-index="${i}" style="background:#555; border:none; color:#fff; padding:4px 8px; border-radius:16px; cursor:pointer;">📋复制BC链接</button>`;
                } else if (mode === 'rpc') {
                    actions = `<button class="action-btn primary" data-action="rpc" data-index="${i}" style="background:${CONFIG.themeColor}; border:none; color:#fff; padding:4px 8px; border-radius:16px; cursor:pointer;">🚀推送</button>`;
                }
                html += `
                    <div class="file-item" data-index="${i}" style="display:flex; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                        <span style="flex:0 0 180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${f.filename}">📄 ${f.filename}${sizeDisplay}</span>
                        <span style="flex:1; margin:0 10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${CONFIG.themeColor}; cursor:pointer;" class="copy-link-trigger" data-index="${i}">${f.url}</span>
                        <div style="display:flex; gap:6px;">
                            ${actions}
                            <button class="action-btn danger" data-action="remove" data-index="${i}" style="background:#cc3235; border:none; color:#fff; padding:4px 8px; border-radius:16px; cursor:pointer;">✖</button>
                        </div>
                    </div>
                `;
            });
        }
        html += `</div>
            <div style="display:flex; justify-content:space-between; margin-top:8px;">
                <div>
                    <button id="modal-import" style="background:transparent; border:1px solid ${CONFIG.themeColor}; color:${CONFIG.themeColor}; padding:6px 12px; border-radius:20px; cursor:pointer;">📥 批量导入</button>
                    <button id="modal-add" style="background:transparent; border:1px solid ${CONFIG.themeColor}; color:${CONFIG.themeColor}; padding:6px 12px; border-radius:20px; margin-left:8px; cursor:pointer;">➕ 手动添加</button>
                </div>
                <div>
                    <button id="modal-export" style="background:#55af28; border:none; color:#fff; padding:6px 12px; border-radius:20px; cursor:pointer;">📋 导出全部</button>
                    <button id="modal-clear" style="background:#cc3235; border:none; color:#fff; padding:6px 12px; border-radius:20px; margin-left:8px; cursor:pointer;">🗑️ 清空</button>
                    <button id="modal-batch-rpc" style="background:#E91E63; border:none; color:#fff; padding:6px 12px; border-radius:20px; margin-left:8px; cursor:pointer;">🚀 批量RPC</button>
                </div>
            </div>
        `;
        contentDiv.innerHTML = html;

        // 绑定事件
        const modeBtn = contentDiv.querySelector('#modal-mode-btn');
        const modeMenu = contentDiv.querySelector('#modal-mode-menu');
        if (modeBtn) {
            modeBtn.onclick = (e) => {
                e.stopPropagation();
                modeMenu.style.display = modeMenu.style.display === 'block' ? 'none' : 'block';
            };
            document.addEventListener('click', function closeMenu(e) {
                if (!state.modal || !state.modal.contains(e.target) || e.target === modeBtn) return;
                modeMenu.style.display = 'none';
            });
        }
        contentDiv.querySelectorAll('.mode-item').forEach(item => {
            item.onclick = () => {
                state.currentMode = item.dataset.mode;
                refreshModalContent();
            };
        });
        contentDiv.querySelector('#modal-scan')?.addEventListener('click', () => { scanPageLinks(); refreshModalContent(); });
        contentDiv.querySelector('#modal-fetch')?.addEventListener('click', () => { fetchPanLinks().then(() => refreshModalContent()); });
        contentDiv.querySelector('#modal-settings')?.addEventListener('click', () => showRpcSettings());
        contentDiv.querySelector('#modal-import')?.addEventListener('click', () => { batchImportLinks(); setTimeout(refreshModalContent, 500); });
        contentDiv.querySelector('#modal-add')?.addEventListener('click', () => { manualAddLink(); refreshModalContent(); });
        contentDiv.querySelector('#modal-export')?.addEventListener('click', () => batchExport());
        contentDiv.querySelector('#modal-clear')?.addEventListener('click', () => { clearAll(); refreshModalContent(); });
        contentDiv.querySelector('#modal-batch-rpc')?.addEventListener('click', () => batchSendToRPC());

        const fileListDiv = contentDiv.querySelector('#modal-file-list');
        if (fileListDiv) {
            fileListDiv.addEventListener('click', async (e) => {
                const btn = e.target.closest('.action-btn');
                if (btn) {
                    const index = btn.dataset.index;
                    const action = btn.dataset.action;
                    const file = state.capturedFiles[index];
                    if (!file) return;
                    if (action === 'remove') {
                        removeFile(index);
                        refreshModalContent();
                    } else if (action === 'download') {
                        directDownload(file);
                    } else if (action === 'copy') {
                        let txt = '';
                        if (btn.dataset.type === 'aria') txt = toAria2Command(file);
                        else if (btn.dataset.type === 'curl') txt = toCurlCommand(file);
                        else if (btn.dataset.type === 'bc') txt = toBCLink(file);
                        else txt = file.url;
                        GM_setClipboard(txt);
                        showToast('已复制', '#4CAF50');
                    } else if (action === 'rpc') {
                        btn.textContent = '⏳';
                        btn.disabled = true;
                        const ok = await sendToRPC(file);
                        showToast(ok ? '推送成功' : '推送失败', ok ? '#4CAF50' : '#f44336');
                        btn.textContent = '🚀推送';
                        btn.disabled = false;
                    }
                }
                const linkSpan = e.target.closest('.copy-link-trigger');
                if (linkSpan) {
                    const idx = linkSpan.dataset.index;
                    const file = state.capturedFiles[idx];
                    if (file) {
                        GM_setClipboard(file.url);
                        showToast('链接已复制', '#4CAF50');
                    }
                }
            });
        }
    }

    function toggleModal(show) {
        if (!state.modal) createModal();
        const newState = show !== undefined ? show : !state.modalVisible;
        if (newState) {
            refreshModalContent();
            state.modal.style.display = 'block';
            setTimeout(() => {
                state.modal.style.transform = 'translate(-50%, -50%) scale(1)';
                state.modal.style.opacity = '1';
            }, 10);
            state.modalVisible = true;
        } else {
            state.modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
            state.modal.style.opacity = '0';
            setTimeout(() => {
                state.modal.style.display = 'none';
            }, 200);
            state.modalVisible = false;
        }
    }

    function batchExport() {
        if (!state.capturedFiles.length) { showToast('无链接', '#ff9800'); return; }
        let txt = '';
        if (state.currentMode === 'aria') txt = state.capturedFiles.map(toAria2Command).join('\n');
        else if (state.currentMode === 'curl') txt = state.capturedFiles.map(toCurlCommand).join('\n');
        else if (state.currentMode === 'bc') txt = state.capturedFiles.map(toBCLink).join('\n');
        else if (state.currentMode === 'rpc') return showToast('请使用批量RPC推送', '#ff9800');
        else txt = state.capturedFiles.map(f => f.url).join('\n');
        GM_setClipboard(txt);
        showToast(`已导出 ${state.capturedFiles.length} 条`, '#4CAF50');
    }

    // 美化版 RPC 设置子菜单
    function showRpcSettings() {
        const existing = document.getElementById('ud-rpc-settings');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'ud-rpc-settings';
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.95);
            background: rgba(30, 30, 35, 0.98);
            backdrop-filter: blur(12px);
            color: #fff;
            padding: 24px 28px;
            border-radius: 24px;
            z-index: 10030;
            box-shadow: 0 20px 35px rgba(0, 0, 0, 0.3);
            width: 460px;
            max-width: 90vw;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            transition: transform 0.2s ease, opacity 0.2s ease;
            opacity: 0;
        `;
        modal.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 12px;">
                <h3 style="margin:0; font-size: 18px; font-weight: 600; color: ${CONFIG.themeColor}; display: flex; align-items: center; gap: 8px;">
                    <span>⚙️</span> RPC 设置
                    <span style="font-size: 12px; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 20px;">Motrix Next</span>
                </h3>
                <button id="ud-rpc-close" style="background: none; border: none; color: #aaa; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <label style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span style="flex: 0 0 70px;">域名</span>
                    <input id="rpc-domain" type="text" value="${state.rpcConfig.domain}" style="flex:1; background: rgba(0,0,0,0.5); border: 1px solid #444; border-radius: 8px; padding: 8px 12px; color: #fff;">
                </label>
                <label style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span style="flex: 0 0 70px;">端口</span>
                    <input id="rpc-port" type="text" value="${state.rpcConfig.port}" style="flex:1; background: rgba(0,0,0,0.5); border: 1px solid #444; border-radius: 8px; padding: 8px 12px; color: #fff;">
                </label>
                <label style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span style="flex: 0 0 70px;">路径</span>
                    <input id="rpc-path" type="text" value="${state.rpcConfig.path}" style="flex:1; background: rgba(0,0,0,0.5); border: 1px solid #444; border-radius: 8px; padding: 8px 12px; color: #fff;">
                </label>
                <label style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span style="flex: 0 0 70px;">Token</span>
                    <input id="rpc-token" type="text" value="${state.rpcConfig.token}" style="flex:1; background: rgba(0,0,0,0.5); border: 1px solid #444; border-radius: 8px; padding: 8px 12px; color: #fff;" placeholder="可选">
                </label>
                <label style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span style="flex: 0 0 70px;">目录</span>
                    <input id="rpc-dir" type="text" value="${state.rpcConfig.dir}" style="flex:1; background: rgba(0,0,0,0.5); border: 1px solid #444; border-radius: 8px; padding: 8px 12px; color: #fff;">
                </label>
                <label style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span style="flex: 0 0 70px;">主题色</span>
                    <input type="color" id="theme-color" value="${CONFIG.themeColor}" style="width: 50px; height: 36px; background: #333; border: 1px solid #555; border-radius: 8px; cursor: pointer;">
                </label>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 28px;">
                <button id="rpc-save" style="background: ${CONFIG.themeColor}; border: none; color: #fff; padding: 8px 20px; border-radius: 40px; font-weight: 500; cursor: pointer;">保存</button>
                <button id="rpc-cancel" style="background: rgba(255,255,255,0.15); border: none; color: #fff; padding: 8px 20px; border-radius: 40px; cursor: pointer;">取消</button>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => {
            modal.style.transform = 'translate(-50%, -50%) scale(1)';
            modal.style.opacity = '1';
        }, 10);

        const closeBtn = modal.querySelector('#ud-rpc-close');
        const cancelBtn = modal.querySelector('#rpc-cancel');
        const saveBtn = modal.querySelector('#rpc-save');
        const closeModal = () => {
            modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
            modal.style.opacity = '0';
            setTimeout(() => modal.remove(), 200);
        };
        closeBtn.onclick = closeModal;
        cancelBtn.onclick = closeModal;
        saveBtn.onclick = () => {
            state.rpcConfig.domain = document.getElementById('rpc-domain').value;
            state.rpcConfig.port = document.getElementById('rpc-port').value;
            state.rpcConfig.path = document.getElementById('rpc-path').value;
            state.rpcConfig.token = document.getElementById('rpc-token').value;
            state.rpcConfig.dir = document.getElementById('rpc-dir').value;
            const newColor = document.getElementById('theme-color').value;
            CONFIG.themeColor = newColor;
            GM_setValue('themeColor', newColor);
            saveRpcConfig();
            showToast('设置已保存', '#4CAF50');
            closeModal();
            if (state.floatingBtn) {
                state.floatingBtn.style.background = newColor;
            }
            if (state.modal && state.modalVisible) refreshModalContent();
        };
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    }

    // ---------- 网络拦截 ----------
    function installInterceptor() {
        if (state.interceptorInstalled) return;
        state.interceptorInstalled = true;

        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            return originalFetch.apply(this, args).then(resp => {
                if (state.isCapturing) {
                    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
                    if (CONFIG.apiPatterns.some(p => url.includes(p))) {
                        const clone = resp.clone();
                        clone.json().then(d => processData(d, getReferer()))
                             .catch(() => clone.text().then(t => processData(t, getReferer())));
                    }
                }
                return resp;
            });
        };

        const XHR = XMLHttpRequest.prototype;
        const open = XHR.open, send = XHR.send;
        XHR.open = function(method, url) {
            this._url = url;
            return open.apply(this, arguments);
        };
        XHR.send = function(body) {
            this.addEventListener('load', () => {
                if (state.isCapturing && CONFIG.apiPatterns.some(p => this._url.includes(p))) {
                    try {
                        const ct = this.getResponseHeader('content-type') || '';
                        if (ct.includes('json')) processData(JSON.parse(this.responseText), getReferer());
                        else if (ct.includes('text')) processData(this.responseText, getReferer());
                    } catch(e) {}
                }
            });
            return send.apply(this, arguments);
        };
        log('网络拦截器已安装');
    }

    function processData(data, referer) {
        const links = extractLinks(data, referer);
        links.forEach(item => {
            if (/lanzou[a-z0-9]*\.(com|cn|net)/i.test(item.url)) {
                parseLanzou(item.url).then(direct => {
                    if (direct) addCapturedFile(direct, extractFilenameFromUrl(direct), referer);
                    else addCapturedFile(item.url, item.filename, referer);
                });
            } else {
                addCapturedFile(item.url, item.filename, referer);
            }
        });
    }

    function extractLinks(data, referer, depth = 0) {
        if (depth > 3) return [];
        let results = [];
        if (typeof data === 'string') {
            const urls = data.match(/https?:\/\/[^\s"'<>]+/g) || [];
            urls.forEach(u => results.push({ url: u, filename: '', referer }));
        } else if (data && typeof data === 'object') {
            if (data.code === 200 && data.data) {
                if (data.data.raw_url || data.data.download_url) {
                    let u = data.data.raw_url || data.data.download_url;
                    let n = data.data.name || data.data.filename || '';
                    results.push({ url: u, filename: n, referer });
                }
                if (Array.isArray(data.data.files)) {
                    data.data.files.forEach(f => {
                        let u = f.raw_url || f.download_url || f.url;
                        if (u) results.push({ url: u, filename: f.name, referer });
                    });
                }
            }
            CONFIG.urlKeys.forEach(k => {
                if (data[k] && typeof data[k] === 'string' && data[k].startsWith('http')) {
                    results.push({ url: data[k], filename: data.filename || data.name || '', referer });
                }
            });
            for (let k in data) if (data.hasOwnProperty(k)) results.push(...extractLinks(data[k], referer, depth + 1));
        }
        return results;
    }

    function enhanceButtons() {
        document.body.addEventListener('click', e => {
            if (!state.isCapturing) return;
            const target = e.target.closest('a, button, [role="menuitem"]');
            if (!target) return;
            const href = target.href || target.getAttribute('data-url') || target.getAttribute('data-href') || '';
            const text = (target.innerText || '').toLowerCase();

            if (text.includes('下载') || href.includes('/download') || href.includes('/d/')) {
                if (href.startsWith('http')) {
                    if (/lanzou/.test(href)) {
                        parseLanzou(href).then(d => {
                            if (d) addCapturedFile(d, extractFilenameFromUrl(d), getReferer());
                            else addCapturedFile(href, '', getReferer());
                        });
                    } else {
                        addCapturedFile(href, '', getReferer());
                    }
                }
            }

            if (isOpenlistPage() && href.startsWith('http') && !href.endsWith('/')) {
                if (!state.capturedFiles.some(f => f.url === href)) {
                    addCapturedFile(href, target.textContent.trim() || extractFilenameFromUrl(href), location.href);
                }
            }

            if (text.includes('复制链接') || text.includes('永久链接')) {
                if (href) addCapturedFile(href, extractFilenameFromUrl(href), getReferer());
                else navigator.clipboard?.readText().then(txt => {
                    if (txt.startsWith('http')) addCapturedFile(txt, extractFilenameFromUrl(txt), getReferer());
                }).catch(() => {});
            }

            const rawUrl = target.getAttribute('data-raw-url') || target.getAttribute('data-download-url') || href;
            if ((text.includes('下载') || target.getAttribute('aria-label')?.includes('下载')) && rawUrl) {
                addCapturedFile(rawUrl, target.getAttribute('data-filename') || extractFilenameFromUrl(rawUrl), getReferer());
                e.preventDefault();
            }
        });
    }

    // ---------- 菜单与初始化 ----------
    function registerMenu() {
        GM_registerMenuCommand('📋 导出所有链接', batchExport);
        GM_registerMenuCommand('🗑️ 清空所有链接', clearAll);
        GM_registerMenuCommand('⚙️ RPC设置', showRpcSettings);
        GM_registerMenuCommand('🔍 扫描Openlist', scanOpenlistLinks);
        GM_registerMenuCommand('🔎 扫描页面链接', scanPageLinks);
        GM_registerMenuCommand('📥 批量导入链接', batchImportLinks);
        GM_registerMenuCommand('🚀 批量RPC推送', batchSendToRPC);
        GM_registerMenuCommand('🔄 显示/隐藏面板', () => toggleModal());
        GM_registerMenuCommand('🚀 强制激活', forceActivate);
    }

    function forceActivate() {
        if (state.floatingBtn) return showToast('面板已激活');
        loadSettings();
        createFloatingButton();
        createModal();
        installInterceptor();
        enhanceButtons();
        registerMenu();
        showToast('强制激活成功', '#4CAF50');
        if (isOpenlistPage()) setTimeout(scanOpenlistLinks, 1000);
    }

    function init() {
        if (!isSupportedPage()) {
            registerMenu();
            return;
        }
        loadSettings();
        installInterceptor();
        createFloatingButton();
        createModal();
        enhanceButtons();
        registerMenu();
        if (isOpenlistPage()) setTimeout(scanOpenlistLinks, 1500);
        log(`全能下载助手 v${CONFIG.version} 已启动`);
        showToast(`助手 v${CONFIG.version} 已启动 (适配Motrix Next)`, '#4CAF50', 2000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
