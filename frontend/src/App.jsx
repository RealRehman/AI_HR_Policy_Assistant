import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const api = (u, o = {}) => fetch("/api" + u, { credentials: "include", ...o }).then(r => r.json());
const post = (u, b) => api(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const fade = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.35 } };

export default function App() {
  const m = location.pathname.match(/^\/hr-chat\/(.+)$/);
  return m ? <Chat token={m[1]} /> : <Admin />;
}

function Admin() {
  const [auth, setAuth] = useState(null), [docs, setDocs] = useState([]), [st, setSt] = useState({}), [link, setLink] = useState({});
  const [err, setErr] = useState(""), [drag, setDrag] = useState(false), [copied, setCopied] = useState(false);
  const load = () => Promise.all([api("/admin/documents"), api("/admin/stats"), api("/admin/link")]).then(([d, s, l]) => { setDocs(d); setSt(s); setLink(l); });
  useEffect(() => { api("/admin/me").then(r => setAuth(!!r.ok)); }, []);
  useEffect(() => { if (!auth) return; load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [auth]);
  const login = async e => { e.preventDefault(); const f = new FormData(e.target);
    const r = await post("/admin/login", { email: f.get("email"), password: f.get("password") }); r.ok ? setAuth(true) : setErr("Invalid email or password"); };
  const up = async files => { const fd = new FormData(); [...files].forEach(f => fd.append("files", f));
    await fetch("/api/admin/documents", { method: "POST", body: fd, credentials: "include" }); load(); };
  const url = `${location.origin}/hr-chat/${link.token}`;
  if (auth === null) return null;
  if (!auth) return (
    <div className="center"><motion.form {...fade} className="card login" onSubmit={login}>
      <h1>HR Policy Assistant</h1><p className="muted">Admin sign in</p>
      <input name="email" type="email" placeholder="Email" required /><input name="password" type="password" placeholder="Password" required />
      <AnimatePresence>{err && <motion.p {...fade} className="err">{err}</motion.p>}</AnimatePresence>
      <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>Sign in</motion.button></motion.form></div>);
  const cards = [["Documents", st.total], ["Active", st.active], ["Processing", st.processing], ["Failed", st.failed], ["Questions this month", st.questions], ["Unanswered", st.unanswered], ["👍 / 👎", `${st.helpful || 0} / ${st.unhelpful || 0}`]];
  return (
    <div className="wrap">
      <header><h1>HR Policy Assistant</h1>
        <button className="ghost" onClick={() => post("/admin/logout").then(() => setAuth(false))}>Logout</button></header>
      <div className="grid">{cards.map(([k, v], i) => (
        <motion.div key={k} className="card stat" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} whileHover={{ y: -4 }}>
          <b>{v ?? 0}</b><span>{k}</span></motion.div>))}</div>
      <motion.div {...fade} className="card"><h2>Employee chatbot link</h2>
        <div className="row"><code>{link.token ? url : "…"}</code>
          <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied ✓" : "Copy"}</button>
          <button className="ghost" onClick={() => post("/admin/link", { action: "regenerate" }).then(setLink)}>Regenerate</button>
          <button className="ghost" onClick={() => post("/admin/link", { action: "toggle" }).then(setLink)}>{link.enabled ? "Disable" : "Enable"}</button></div></motion.div>
      <motion.label {...fade} className={"card drop" + (drag ? " on" : "")} animate={{ opacity: 1, y: 0, scale: drag ? 1.02 : 1 }}        onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); up(e.dataTransfer.files); }}>
        <input type="file" multiple accept=".pdf,.docx,.txt" hidden onChange={e => up(e.target.files)} />
        <span className="big">⬆</span>Drag & drop policies here, or click to select<small>PDF, DOCX, TXT · max 20 MB</small></motion.label>
      <motion.div {...fade} className="card"><h2>Documents</h2>
        <AnimatePresence>{docs.map(d => (
          <motion.div layout key={d.id} {...fade} className="doc">
            <div><b>{d.name}</b><small>v{d.version} · {d.chunks} chunks</small></div>
            <span className={"pill " + d.status}>{d.status === "indexed" ? (d.active ? "Active" : "Inactive") : d.status}</span>
            <div className="row">{d.status === "indexed" && <button className="ghost" onClick={() => api(`/admin/documents/${d.id}/toggle`, { method: "POST" }).then(load)}>{d.active ? "Deactivate" : "Activate"}</button>}
              <button className="ghost danger" onClick={() => confirm("Delete this document?") && api(`/admin/documents/${d.id}`, { method: "DELETE" }).then(load)}>Delete</button></div>
          </motion.div>))}</AnimatePresence>
        {!docs.length && <p className="muted">No documents yet.</p>}</motion.div>
    </div>);
}

const SUGGEST = ["How many vacation days do I get?", "What is the sick leave policy?", "Can I work remotely?", "How do I submit an expense claim?"];

function Chat({ token }) {
  const [m, setM] = useState([]), [v, setV] = useState(""), [busy, setBusy] = useState(false), end = useRef();
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [m]);
  const send = async text => {
    if (!text.trim() || busy) return;
    const msgs = [...m, { role: "user", content: text }];
    setM([...msgs, { role: "assistant", content: "", src: [] }]); setV(""); setBusy(true);
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, messages: msgs.map(({ role, content }) => ({ role, content })) }) });
      if (!r.ok) throw 0;
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) { const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop();
        for (const l of lines) { if (!l) continue; const o = JSON.parse(l);
          setM(p => { const c = [...p], a = { ...c[c.length - 1] }; if (o.t) a.content += o.t; if (o.src) a.src = o.src; c[c.length - 1] = a; return c; }); } }
    } catch { setM(p => { const c = [...p]; c[c.length - 1] = { role: "assistant", content: "I'm temporarily unable to process your question. Please try again shortly.", src: [] }; return c; }); }
    setBusy(false);
  };
  return (
    <div className="chat">
      <header><div><h1>HR Policy Assistant</h1><p className="muted">Ask questions about company policies</p></div>
        {m.length > 0 && <button className="ghost" onClick={() => setM([])}>Clear</button>}</header>
      <div className="msgs">
        {!m.length && <motion.div {...fade} className="hello"><h2>Hi! 👋 How can I help?</h2>
          <div className="chips">{SUGGEST.map((s, i) => <motion.button key={s} className="chip" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.08 }} whileHover={{ scale: 1.04 }} onClick={() => send(s)}>{s}</motion.button>)}</div></motion.div>}
        <AnimatePresence initial={false}>{m.map((x, i) => <Msg key={i} x={x} prev={m[i - 1]} token={token} last={i === m.length - 1 && busy} />)}</AnimatePresence>
        <div ref={end} /></div>
      <form className="bar" onSubmit={e => { e.preventDefault(); send(v); }}>
        <input value={v} onChange={e => setV(e.target.value)} placeholder="Ask a question…" maxLength={1000} />
        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} disabled={busy}>➤</motion.button></form>
    </div>);
}

function Msg({ x, prev, token, last }) {
  const [fb, setFb] = useState(null), [cp, setCp] = useState(false), ai = x.role === "assistant";
  const rate = r => { setFb(r); post("/chat/feedback", { token, question: prev?.content, answer: x.content, rating: r }); };
  return (
    <motion.div layout initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 26 }} className={"msg " + (ai ? "ai" : "me")}>
      {ai && !x.content && last ? <span className="dots"><i /><i /><i /></span> : ai
        ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: p => <div className="tw"><table {...p.node && {}} {...Object.fromEntries(Object.entries(p).filter(([k]) => k !== "node"))} /></div> }}>{x.content}</ReactMarkdown></div>
        : <p>{x.content}</p>}
      {ai && x.src?.length > 0 && <div className="src">{x.src.map((s, i) => <span key={i}>📄 {s.doc} · {s.section} · p.{s.page}</span>)}</div>}
      {ai && x.content && !last && <div className="acts">
        <button className="ghost" onClick={() => { navigator.clipboard.writeText(x.content); setCp(true); setTimeout(() => setCp(false), 1200); }}>{cp ? "Copied ✓" : "Copy"}</button>
        <motion.button whileTap={{ scale: 1.4 }} className={"ghost" + (fb === "up" ? " sel" : "")} onClick={() => rate("up")}>👍</motion.button>
        <motion.button whileTap={{ scale: 1.4 }} className={"ghost" + (fb === "down" ? " sel" : "")} onClick={() => rate("down")}>👎</motion.button></div>}
    </motion.div>);
}
