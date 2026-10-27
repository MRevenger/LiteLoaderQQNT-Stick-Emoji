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

// ---- 从 DOM 直接读消息的会话信息 ----
// 9.9.28 的 aiO 消息列表把每条消息渲染成 Vue 组件（div.message），组件链里带着完整消息对象，
// 比事件索引可靠：历史消息、别人的消息都能读到。

function isDomNode(value) {
    return value != null && typeof value === "object" && typeof value.nodeType === "number"
}

// 收集元素及其祖先/子树上的 Vue 组件实例：
// LiteLoader 会给被 hook 的组件加 .vue-component 类并把实例放进 el.__VUE__；
// Vue3 原生是 el.__vueParentComponent，Vue2 是 el.__vue__。
function pushInstances(out, el) {
    try {
        if (Array.isArray(el.__VUE__)) for (const inst of el.__VUE__) if (inst) out.push(inst)
        if (el.__vueParentComponent) out.push(el.__vueParentComponent)
        if (el.__vue__) out.push(el.__vue__)
    } catch { }
}

function collectInstances(root) {
    const out = []
    let node = root
    for (let i = 0; node && i < 4; i++, node = node.parentElement) pushInstances(out, node)
    const stack = [root]
    const seen = new Set()
    while (stack.length && seen.size < 4000) {
        const el = stack.pop()
        if (!el || seen.has(el)) continue
        seen.add(el)
        pushInstances(out, el)
        const children = el.children
        if (children) for (let i = 0; i < children.length; i++) stack.push(children[i])
    }
    return out
}

function pickMessageInfo(obj, wantedMsgId) {
    if (!obj || typeof obj !== "object" || isDomNode(obj) || typeof obj === "function") return null
    // 有 msgId 就必须和右键那条一致，避免抓到旁边别的对象（头像/成员等）
    if (wantedMsgId != null && obj.msgId != null && String(obj.msgId) !== String(wantedMsgId)) return null
    const chatType = obj.chatType ?? obj.peer?.chatType
    const peerUid = obj.peerUid ?? obj.peer?.peerUid
    const msgSeq = obj.msgSeq
    if (chatType == null || peerUid == null || msgSeq == null) return null
    return {
        chatType, peerUid, msgSeq,
        msgId: obj.msgId,
        senderUin: obj.senderUin,
        peerName: obj.peerName
    }
}

function searchMessageInfo(seeds, wantedMsgId) {
    const queue = []
    for (const seed of seeds) if (seed && typeof seed === "object") queue.push({node: seed, depth: 0})
    const seen = new Set()
    let visited = 0
    while (queue.length && visited < 6000) {
        const {node, depth} = queue.shift()
        visited++
        if (!node || typeof node !== "object" || isDomNode(node) || seen.has(node)) continue
        seen.add(node)
        const hit = pickMessageInfo(node, wantedMsgId)
        if (hit) return hit
        if (depth >= 4) continue
        let keys = []
        try { keys = Object.keys(node).slice(0, 40) } catch { continue }
        for (const key of keys) {
            let value
            try { value = node[key] } catch { continue }
            if (value && typeof value === "object" && !isDomNode(value)) queue.push({node: value, depth: depth + 1})
        }
    }
    return null
}

export function getMessageInfoFromDom(element, msgId) {
    try {
        const root = element?.closest?.(".ml-item") ?? element
        if (!root) return null
        const instances = collectInstances(root)
        for (const instance of instances) {
            const hit = searchMessageInfo([
                instance, instance.props, instance.ctx, instance.data,
                instance.setupState, instance.vnode?.props, instance.proxy
            ])
            if (hit) return hit
        }
        return null
    } catch (e) {
        pluginDebug("DOM 读消息信息失败: " + (e?.message ?? e))
        return null
    }
}

// 诊断用：把元素的 Vue 结构与实例字段打出来
export function probeVueDom(element) {
    try {
        const root = element?.closest?.(".ml-item") ?? element
        const lines = []
        let node = root
        for (let i = 0; node && i < 4; i++, node = node.parentElement) {
            let props = []
            try { props = Object.getOwnPropertyNames(node).filter(n => /vue/i.test(n)) } catch { }
            lines.push((node.tagName || "?") + "." + String(node.className || "").slice(0, 28) + "->" + (props.join(",") || "-"))
        }
        const instances = collectInstances(root)
        lines.push("实例数=" + instances.length)
        if (instances.length) {
            const inst = instances[instances.length - 1]
            for (const key of ["props", "ctx", "data", "setupState", "vnode.props"]) {
                try {
                    const value = key === "vnode.props" ? inst.vnode?.props : inst[key]
                    lines.push(key + "={" + Object.keys(value ?? {}).slice(0, 12).join(",") + "}")
                } catch { }
            }
        }
        pluginDebug("Vue探针: " + lines.join(" | "))
    } catch (e) {
        pluginDebug("Vue探针失败: " + (e?.message ?? e))
    }
}
