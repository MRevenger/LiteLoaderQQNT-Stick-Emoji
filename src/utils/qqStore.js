// QQ 内部 pinia store 的容错读取。
// 9.9.28 起根节点上不再有 __vue_app__，改为从任意 Vue 组件实例（__vueParentComponent）反查 appContext，
// 再顺着 globalProperties 拿 $store / $pinia。全部失败时返回 null，由调用方降级。
import {pluginDebug} from "./frontLog.js";

let cachedState = null
let cachedSource = null
let bridgeUin = null

// 自己的 QQ 号由主进程 onLogin 钩子 / onSessionInitComplete 事件注入，不依赖 QQ 的 store
export function setBridgeUin(uid) {
    if (uid != null) bridgeUin = String(uid)
}

function scanForVueRoot() {
    const stack = [document.documentElement]
    let visited = 0
    while (stack.length && visited < 20000) {
        const el = stack.pop()
        visited++
        if (!el) continue
        try {
            if (el.__vue_app__) return {el, kind: "__vue_app__"}
        } catch { }
        try {
            if (el.__vueParentComponent) return {el, kind: "__vueParentComponent"}
        } catch { }
        const children = el.children
        if (children) for (let i = 0; i < children.length; i++) stack.push(children[i])
    }
    return null
}

function globalProperties() {
    const hit = scanForVueRoot()
    if (!hit) return null
    try {
        if (hit.kind === "__vue_app__") {
            const gp = hit.el.__vue_app__?.config?.globalProperties
            if (gp) return {gp, source: "el.__vue_app__"}
        }
        const gp = hit.el.__vueParentComponent?.appContext?.config?.globalProperties
        if (gp) return {gp, source: "el.__vueParentComponent"}
    } catch { }
    return null
}

export function getStoreState() {
    if (cachedState) return cachedState
    const hit = globalProperties()
    if (!hit) return null
    try {
        const state = hit.gp.$store?.state
        if (state) {
            cachedState = state
            cachedSource = hit.source + ".$store"
            return cachedState
        }
    } catch { }
    try {
        const state = hit.gp.$pinia?.state?.value
        if (state) {
            cachedState = state
            cachedSource = hit.source + ".$pinia"
            return cachedState
        }
    } catch { }
    return null
}

export function pick(path) {
    try {
        return path.split(".").reduce((obj, key) => (obj == null ? undefined : obj[key]), getStoreState())
    } catch { return undefined }
}

function findByShape(test) {
    const state = getStoreState()
    if (!state) return undefined
    for (const value of Object.values(state)) {
        try { if (value && typeof value === "object" && test(value)) return value } catch { }
    }
    return undefined
}

export function getSelfUin() {
    if (bridgeUin) return bridgeUin
    const direct = pick("common_Auth.authData.account")
    if (direct != null) return String(direct)
    const hit = findByShape(v => v.authData && (v.authData.account != null || v.authData.uin != null))
    if (hit) return String(hit.authData.account ?? hit.authData.uin)
    return null
}

export function getCurAioData() {
    const direct = pick("common_Aio.curAioData")
    if (direct) return direct
    return findByShape(v => v.curAioData)?.curAioData ?? null
}

export function getCurMsgs() {
    const direct = pick("aio_chatMsgArea.msgListRef.curMsgs")
    if (Array.isArray(direct)) return direct
    const hit = findByShape(v => Array.isArray(v.msgListRef?.curMsgs))
    return hit?.msgListRef?.curMsgs ?? []
}

// 只在 store 不可用时打一条，避免刷日志
export async function probeStore() {
    if (cachedState) return
    const state = getStoreState()
    if (!state) {
        pluginDebug("store 不可用（9.9.28 已移除 globalProperties 上的 $store/$pinia），改用消息索引兜底")
        return
    }
    pluginDebug("store 可用：来源=" + cachedSource + " 模块数=" + Object.keys(state).length)
}
