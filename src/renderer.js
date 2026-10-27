// 运行在 Electron 渲染进程 下的页面脚本

import {pluginLog, pluginDebug} from "./utils/frontLog.js";
import {listenMenu} from "./utils/rightClickMenu.js";
import {stickEmojiSelf} from "./utils/stickEmoji.js";
import {SettingListeners} from "./utils/SettingListeners.js";
import {probeStore, setBridgeUin} from "./utils/qqStore.js";
import {rememberMessages} from "./utils/msgCache.js";

const pluginAPI = window.stick_emoji
const BUILD = "1.1.0"

let msgListener = null
let menuHooked = false
let selfUinTask = null

pluginDebug("renderer 启动 build=" + BUILD + " hash=" + location.hash)
try {
    await onLoad();//注入
} catch (e) {
    pluginDebug("onLoad 失败(设置页仍可用): " + (e?.stack ?? e))
}

// 打开设置界面时触发
export const onSettingWindowCreated = async view => {
    // view 为 Element 对象，修改将同步到插件设置界面
    // 这个函数导出之后在QQ设置里面可以直接看见插件页面

    try {
        //整个插件主菜单
        const parser = new DOMParser()
        const settingHTML = parser
            .parseFromString(await pluginAPI.getMenuHTML(), "text/html")
            .querySelector("plugin-menu")

        const myListener = new SettingListeners(settingHTML)
        myListener.onLoad()
        view.appendChild(settingHTML)
    } catch (e) {
        pluginDebug("设置页面加载失败: " + (e?.stack ?? e))
    }
}

async function onLoad() {
    if (location.hash === "#/blank") {
        navigation.addEventListener("navigatesuccess", onHashUpdate, {once: true});
    } else {
        await onHashUpdate();
    }

    pluginLog('onLoad函数加载完成')
}

// 自己的标识：主进程 onLogin 钩子 + onSessionInitComplete 事件双来源
function ensureSelfUin() {
    if (selfUinTask) return selfUinTask
    selfUinTask = (async () => {
        for (let i = 0; i < 15; i++) {
            let uid = null
            try { uid = await pluginAPI.getSelfUid() } catch (e) { }
            if (uid) {
                setBridgeUin(uid)
                pluginDebug("自己标识 = " + uid)
                return
            }
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
        pluginDebug("拿不到自己的标识（getSelfUid 一直为空）")
    })()
    return selfUinTask
}

async function onHashUpdate() {
    const hash = location.hash;
    if (hash === '#/blank') return
    if (!(hash.includes("#/main/message") || hash.includes("#/chat"))) return;//不符合条件直接返回

    pluginLog('执行onHashUpdate')
    ensureSelfUin()
    await probeStore()
    if (!menuHooked) {
        menuHooked = true
        listenMenu()
    }
    if (msgListener) return//切页面重复触发时不再重复订阅

    try {
        msgListener = pluginAPI.subscribeEvent('nodeIKernelMsgListener/onMsgInfoListUpdate',
            async (payload) => {
                try {
                    // 先检查配置中的自动贴表情开关
                    rememberMessages(payload?.msgList)
                    try {
                        const compact = (payload?.msgList ?? []).map(m => ({
                            msgId: m?.msgId, chatType: m?.chatType, peerUid: m?.peerUid, msgSeq: m?.msgSeq
                        }))
                        if (compact.length) pluginAPI.rememberMsgs(compact)
                    } catch (e) { }
                    const config = await pluginAPI.getConfig()
                    if (!config.autoStick) return
                    await stickEmojiSelf(payload, config)
                } catch (e) {
                    pluginDebug("处理消息失败: " + (e?.stack ?? e))
                }
            })
        pluginAPI.subscribeEvent("nodeIKernelSessionListener/onSessionInitComplete", payload => {
            if (payload?.uid != null) setBridgeUin(payload.uid)
        })
        pluginLog("事件监听成功")
    } catch (e) {
        pluginDebug("事件监听失败: " + (e?.stack ?? e))
    }
}
