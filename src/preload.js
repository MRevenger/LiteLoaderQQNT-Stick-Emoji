// Electron 主进程 与 渲染进程 交互的桥梁
// QQ 9.9.x 起：通道为 RM_IPCFROM_RENDERER<id> / RM_IPCFROM_MAIN<id>，内核调用 eventName 为 "ntApi"，
// peerId 必须是数字；旧的 ___!boot + IPC_UP_/IPC_DOWN_ 写法在 9.9.28 上已完全失效。
const {contextBridge, ipcRenderer} = require("electron");

const IPC_TIMEOUT = 10000;
const subscriptions = new Map();
let nativeBridgePromise;

// preload 可能早于 onBrowserWindowCreated 执行，因此不能在启动期用 sendSync 取 id
function getNativeBridge() {
    if (!nativeBridgePromise) {
        nativeBridgePromise = withTimeout(
            Promise.resolve().then(() => ipcRenderer.invoke("LiteLoader.stick_emoji.getWebContentsId")),
            "webContentsId"
        ).then(id => {
            const numericId = Number(id);
            if (!Number.isSafeInteger(numericId) || numericId <= 0) {
                throw new Error("Invalid stick_emoji webContentsId: " + id);
            }
            return {
                webContentsId: numericId,
                requestChannel: `RM_IPCFROM_RENDERER${numericId}`,
                responseChannels: [...new Set([`RM_IPCFROM_MAIN${numericId}`, "RM_IPCFROM_MAIN2"])]
            };
        }).catch(error => {
            nativeBridgePromise = undefined;
            throw error;
        });
    }
    return nativeBridgePromise;
}

function withTimeout(promise, operation) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            clearTimeout(timer);
            reject(new Error(`[Stick-Emoji] ${operation} timed out`));
        }, IPC_TIMEOUT);
        promise.then(value => {
            clearTimeout(timer);
            resolve(value);
        }, error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

contextBridge.exposeInMainWorld("stick_emoji", {
    getMenuHTML: () => ipcRenderer.invoke("LiteLoader.stick_emoji.getMenuHTML"),
    getConfig: () => ipcRenderer.invoke("LiteLoader.stick_emoji.getConfig"),
    setConfig: (newConfig) => ipcRenderer.invoke("LiteLoader.stick_emoji.setConfig", newConfig),
    debugLog: (message) => ipcRenderer.invoke("LiteLoader.stick_emoji.debugLog", message),
    getSelfUid: () => ipcRenderer.invoke("LiteLoader.stick_emoji.getSelfUid"),
    getMsgInfo: (msgId) => ipcRenderer.invoke("LiteLoader.stick_emoji.getMsgInfo", msgId),
    rememberMsgs: (list) => ipcRenderer.send("LiteLoader.stick_emoji.rememberMsgs", list),
    getBridgeInfo: () => getNativeBridge()
        .then(b => `id=${b.webContentsId} req=${b.requestChannel} res=${b.responseChannels.join("|")}`)
        .catch(e => "bridge error: " + e),
    invokeNative: (cmdName, ...args) => invokeNative(cmdName, ...args),
    subscribeEvent: (cmdName, handler) => subscribeEvent(cmdName, handler),
    unsubscribeEvent: (handler) => unsubscribeEvent(handler),
    addEventListener: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
});

function newCallbackId() {
    return crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** 调用一个qq底层函数（eventName 固定 ntApi），返回内核给的返回值。 */
async function invokeNative(cmdName, ...args) {
    const bridge = await getNativeBridge();
    return new Promise((resolve, reject) => {
        const callbackId = newCallbackId();
        let timer;
        const cleanup = () => {
            clearTimeout(timer);
            for (const channel of bridge.responseChannels) ipcRenderer.off(channel, callback);
        };
        const callback = (_event, ...resultArgs) => {
            if (resultArgs?.[0]?.callbackId === callbackId) {
                cleanup();
                resolve(resultArgs[1]);
            }
        };
        try {
            for (const channel of bridge.responseChannels) ipcRenderer.on(channel, callback);
            timer = setTimeout(() => {
                cleanup();
                reject(new Error(`[Stick-Emoji] ${cmdName} timed out`));
            }, IPC_TIMEOUT);
            ipcRenderer.send(bridge.requestChannel, {
                type: "request",
                callbackId,
                eventName: "ntApi",
                peerId: bridge.webContentsId
            }, {
                cmdName,
                cmdType: "invoke",
                payload: args
            });
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
}

/** 为qq底层事件 `cmdName` 添加 `handler` 处理器。 */
function subscribeEvent(cmdName, handler) {
    const subscription = {channels: []};
    const reportError = error => console.error("[Stick-Emoji] event handler failed:", cmdName, error);
    const dispatch = payload => {
        try {
            Promise.resolve(handler(payload)).catch(reportError);
        } catch (error) {
            reportError(error);
        }
    };
    const listener = (_event, ...args) => {
        if (args?.[1]?.cmdName === cmdName) {
            dispatch(args[1].payload);
            return;
        }
        if (args?.[3]?.[1]?.cmdName === cmdName) {
            dispatch(args[3][1].payload);
        }
    };
    subscriptions.set(listener, subscription);
    getNativeBridge().then(bridge => {
        if (!subscriptions.has(listener)) return;
        subscription.channels = bridge.responseChannels;
        for (const channel of subscription.channels) ipcRenderer.on(channel, listener);
    }).catch(error => {
        unsubscribeEvent(listener);
        console.error("[Stick-Emoji] subscribeEvent failed:", error);
    });
    return listener;
}

/** 移除qq底层事件的 `handler` 处理器。 */
function unsubscribeEvent(handler) {
    const subscription = subscriptions.get(handler);
    if (!subscription) return;
    subscriptions.delete(handler);
    for (const channel of subscription.channels) ipcRenderer.off(channel, handler);
}
