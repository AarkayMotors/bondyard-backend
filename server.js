import React, { useEffect, useMemo, useRef, useState } from "react";

// === CONFIG ===
// Flip this to false if you want to run local-only without the backend.
const USE_API = true;
// Prefer Vite (VITE_API_BASE) or CRA (REACT_APP_API_BASE) env var at build time
const API_BASE = (import.meta?.env?.VITE_API_BASE || process.env.REACT_APP_API_BASE || "http://localhost:8080/api").replace(/\/$/, "");

// Small helper
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const toISODate = (d) => (d ? new Date(d).toISOString() : null);
const fromISODate = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const classNames = (...xs) => xs.filter(Boolean).join(" ");

// Local storage (fallback mode)
const LS_KEY = "bondyard_inventory_v1";
const saveLocal = (items) => localStorage.setItem(LS_KEY, JSON.stringify(items));
const loadLocal = () => { try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; } };

// === API CLIENT ===
async function apiFetch(path, opts={}) {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { ...(opts.headers||{}), ...(opts.body instanceof FormData ? {} : {"Content-Type":"application/json"}) } });
  if (!res.ok) throw new Error(await res.text());
  return res.headers.get("content-type")?.includes("application/json") ? res.json() : res.text();
}
const api = {
  list: () => apiFetch(`/vehicles`, { method: "GET" }),
  create: (v) => apiFetch(`/vehicles`, { method: "POST", body: JSON.stringify(v) }),
  update: (id, v) => apiFetch(`/vehicles/${id}`, { method: "PUT", body: JSON.stringify(v) }),
  remove: (id) => apiFetch(`/vehicles/${id}`, { method: "DELETE" }),
  addMove: (id, m) => apiFetch(`/vehicles/${id}/movements`, { method: "POST", body: JSON.stringify(m) }),
  delMove: (id, mid) => apiFetch(`/vehicles/${id}/movements/${mid}`, { method: "DELETE" }),
  addFiles: async (id, files) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.name);
    const res = await fetch(`${API_BASE}/vehicles/${id}/attachments`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  delFile: (id, aid) => apiFetch(`/vehicles/${id}/attachments/${aid}`, { method: "DELETE" }),
};

// === UI HELPERS ===
function Badge({ children, tone = "slate" }) {
  const tones = { slate: "bg-slate-100 text-slate-700", green: "bg-green-100 text-green-700", red: "bg-red-100 text-red-700", amber: "bg-amber-100 text-amber-700", blue: "bg-blue-100 text-blue-700", violet: "bg-violet-100 text-violet-700" };
  return <span className={classNames("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}
function Pill({ active, children, onClick }) { return (
  <button onClick={onClick} className={classNames("px-3 py-1 rounded-full text-sm border transition", active?"bg-black text-white border-black":"bg-white text-slate-700 border-slate-200 hover:border-slate-400")}>{children}</button>
); }
function EmptyState({ title, subtitle, action }) { return (
  <div className="text-center p-10 border-2 border-dashed rounded-2xl"><h3 className="text-lg font-semibold">{title}</h3><p className="text-slate-500 mt-1">{subtitle}</p>{action}</div>
); }

// === FORM FIELDS ===
function FieldShell({ label, children }) { return (<div><label className="block text-sm font-medium mb-1">{label}</label>{children}</div>); }
function TextField({ label, value, onChange, placeholder, type = "text", required, className }) { return (
  <FieldShell label={label}><input type={type} required={required} value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} className={classNames("w-full h-10 px-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-black/20", className)} /></FieldShell>
); }
function TextArea({ label, value, onChange, placeholder }) { return (
  <FieldShell label={label}><textarea value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} rows={3} className="w-full p-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-black/20"/></FieldShell>
); }
function DateField({ label, value, onChange }) { return (
  <FieldShell label={label}><input type="date" value={value||""} onChange={(e)=>onChange(e.target.value)} className="w-full h-10 px-3 rounded-xl border"/></FieldShell>
); }
function SelectField({ label, value, onChange, options }) { return (
  <FieldShell label={label}><select value={value} onChange={(e)=>onChange(e.target.value)} className="w-full h-10 px-3 rounded-xl border">{options.map((o)=>(<option key={o} value={o}>{o}</option>))}</select></FieldShell>
); }

// === ATTACHMENT PICKER ===
function AttachmentPicker({ onAdd }) {
  const inputRef = useRef(null);
  return (
    <div>
      <input ref={inputRef} type="file" multiple className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-black file:text-white hover:file:bg-slate-800" onChange={(e)=>{ const files = Array.from(e.target.files||[]); onAdd(files); if (inputRef.current) inputRef.current.value=""; }} />
      <p className="text-xs text-slate-500 mt-1">Attach photos, PDFs, or any document.</p>
    </div>
  );
}

// === VEHICLE FORM ===
function VehicleForm({ initial, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial || { vin:"", stockNo:"", make:"", model:"", year:"", color:"", location:"", status:"In Bond", supplier:"", buyer:"", inDate:new Date().toISOString(), outDate:null, notes:"", attachments:[], movements:[] });
  const set = (k, v) => setForm((s)=>({ ...s, [k]: v }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <TextField label="VIN" value={form.vin} onChange={(v)=>set("vin", v)} required placeholder="1HGCM82633A004352" />
        <TextField label="Stock #" value={form.stockNo} onChange={(v)=>set("stockNo", v)} />
        <TextField label="Make" value={form.make} onChange={(v)=>set("make", v)} />
        <TextField label="Model" value={form.model} onChange={(v)=>set("model", v)} />
        <TextField label="Year" type="number" value={form.year} onChange={(v)=>set("year", v)} />
        <TextField label="Color" value={form.color} onChange={(v)=>set("color", v)} />
        <TextField label="Location" value={form.location} onChange={(v)=>set("location", v)} placeholder="Yard/Slot" />
        <SelectField label="Status" value={form.status} onChange={(v)=>set("status", v)} options={["In Bond","Released","Sold","Hold"]} />
        <TextField label="Supplier" value={form.supplier} onChange={(v)=>set("supplier", v)} />
        <TextField label="Buyer" value={form.buyer} onChange={(v)=>set("buyer", v)} />
        <DateField label="In Date" value={fromISODate(form.inDate)} onChange={(v)=>set("inDate", toISODate(v))} />
        <DateField label="Out Date" value={fromISODate(form.outDate)} onChange={(v)=>set("outDate", toISODate(v))} />
      </div>
      <TextArea label="Notes" value={form.notes} onChange={(v)=>set("notes", v)} placeholder="Condition, paperwork, keys, etc." />
      <div className="flex gap-3 justify-end pt-2">
        <button className="px-4 py-2 rounded-xl border" onClick={onCancel}>Cancel</button>
        <button className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-50" disabled={!form.vin} onClick={()=>onSubmit(form)}>Save Vehicle</button>
      </div>
    </div>
  );
}

// === MOVEMENT FORM ===
function MovementForm({ onAdd }) {
  const [type, setType] = useState("INWARD");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  return (
    <div className="grid md:grid-cols-4 gap-3 items-end">
      <SelectField label="Type" value={type} onChange={setType} options={["INWARD","OUTWARD"]} />
      <DateField label="Date" value={date} onChange={setDate} />
      <TextField label="Qty" value={qty} onChange={setQty} />
      <div className="flex gap-2">
        <TextField label="Notes" value={notes} onChange={setNotes} className="w-full" />
        <button className="h-10 px-4 rounded-xl bg-black text-white" onClick={()=>{ onAdd({ id: uid(), type, date: toISODate(date), qty, notes }); setNotes(""); }}>Add</button>
      </div>
    </div>
  );
}

// === MODAL ===
function Modal({ title, children, onClose }) { useEffect(()=>{ const onKey=(e)=>e.key==="Escape"&&onClose(); window.addEventListener("keydown", onKey); return ()=>window.removeEventListener("keydown", onKey); },[onClose]); return (
  <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}><div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl" onClick={(e)=>e.stopPropagation()}><div className="p-4 border-b flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button className="text-slate-600" onClick={onClose}>✕</button></div><div className="p-4">{children}</div></div></div>
); }

// === MAIN APP ===
export default function BondYardInventory() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load initial data
  useEffect(() => {
    (async () => {
      try {
        if (USE_API) {
          const vs = await api.list();
          setItems(vs);
        } else {
          setItems(loadLocal());
        }
      } catch (e) {
        setError(String(e.message||e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Persist locally when not using API
  useEffect(() => { if (!USE_API) saveLocal(items); }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((v) => {
      const matchesQ = !q || [v.vin, v.stockNo, v.make, v.model, String(v.year), v.color, v.location, v.supplier, v.buyer].filter(Boolean).join(" ").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "ALL" || v.status === statusFilter;
      return matchesQ && matchesStatus;
    });
  }, [items, query, statusFilter]);

  const totalIn = (v) => (v.movements||[]).filter((m)=>m.type==="INWARD").reduce((a,b)=>a+Number(b.qty||0),0);
  const totalOut = (v) => (v.movements||[]).filter((m)=>m.type==="OUTWARD").reduce((a,b)=>a+Number(b.qty||0),0);
  const onHand = (v) => totalIn(v) - totalOut(v);

  async function addVehicle(data) {
    try {
      if (USE_API) {
        const created = await api.create(data);
        setItems((s)=>[created, ...s]);
      } else {
        const vehicle = { id: uid(), ...data };
        if (!vehicle.movements || vehicle.movements.length===0) vehicle.movements=[{ id: uid(), type:"INWARD", date: vehicle.inDate || new Date().toISOString(), qty: "1", notes: "Initial stock" }];
        setItems((s)=>[vehicle, ...s]);
      }
      setCreating(false);
    } catch (e) {
      alert(`Create failed: ${e}`);
    }
  }

  async function updateVehicle(id, patch) {
    try {
      if (USE_API) {
        const merged = items.find((v)=>v.id===id);
        const updated = await api.update(id, { ...merged, ...patch });
        setItems((s)=>s.map((v)=>v.id===id?updated:v));
      } else {
        setItems((s)=>s.map((v)=>v.id===id?{...v, ...patch}:v));
      }
    } catch (e) { alert(`Update failed: ${e}`); }
  }

  async function removeVehicle(id) {
    if (!confirm("Delete this vehicle? This cannot be undone.")) return;
    try { if (USE_API) await api.remove(id); setItems((s)=>s.filter((v)=>v.id!==id)); } catch (e) { alert(`Delete failed: ${e}`); }
  }

  async function addMovement(id, m) {
    try {
      if (USE_API) {
        const v = await api.addMove(id, m);
        setItems((s)=>s.map((x)=>x.id===id?v:x));
      } else {
        setItems((s)=>s.map((x)=>x.id===id?{...x, movements:[...(x.movements||[]), m]}:x));
      }
    } catch (e) { alert(`Movement failed: ${e}`); }
  }

  async function removeMovement(id, mid) {
    try {
      if (USE_API) {
        const v = (await api.delMove(id, mid));
        setItems((s)=>s.map((x)=>x.id===id?v:x));
      } else {
        setItems((s)=>s.map((x)=>x.id===id?{...x, movements:x.movements.filter((m)=>m.id!==mid)}:x));
      }
    } catch (e) { alert(`Remove failed: ${e}`); }
  }

  async function addAttachments(id, files) {
    try {
      if (USE_API) {
        const uploaded = await api.addFiles(id, files);
        setItems((s)=>s.map((x)=>x.id===id?{...x, attachments:[...(x.attachments||[]), ...uploaded]}:x));
      } else {
        // fallback: read files as data URLs
        const mapped = await Promise.all(Array.from(files).map((f)=>new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve({ id: uid(), name:f.name, mime:f.type, size:f.size, dataUrl:r.result }); r.onerror=reject; r.readAsDataURL(f); })));
        setItems((s)=>s.map((x)=>x.id===id?{...x, attachments:[...(x.attachments||[]), ...mapped]}:x));
      }
    } catch (e) { alert(`Upload failed: ${e}`); }
  }

  async function removeAttachment(id, aid) {
    try {
      if (USE_API) await api.delFile(id, aid);
      setItems((s)=>s.map((x)=>x.id===id?{...x, attachments:(x.attachments||[]).filter((a)=>a.id!==aid)}:x));
    } catch (e) { alert(`Delete file failed: ${e}`); }
  }

  function downloadDataUrl(name, url) { const a=document.createElement("a"); a.href=url; a.download=name; a.target="_blank"; a.click(); }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/80 border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-black text-white grid place-items-center">BY</div>
            <div>
              <h1 className="text-xl font-bold">Bond Yard Inventory</h1>
              <p className="text-xs text-slate-500">Cloud {USE_API?`API: ${API_BASE}`:"Local-only demo"}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-xl border" onClick={()=>{
              const headers=["VIN","StockNo","Make","Model","Year","Color","Location","Status","Supplier","Buyer","InDate","OutDate","Notes","OnHand"]; const rows=items.map((v)=>[v.vin,v.stockNo,v.make,v.model,v.year,v.color,v.location,v.status,v.supplier,v.buyer,v.inDate,v.outDate,(v.notes||"").replace(/\n/g," "), (totalIn(v)-totalOut(v))]); const csv=[headers.join(","), ...rows.map((r)=>r.map((x)=>`"${String(x??"").replaceAll('"','""')}"`).join(","))].join("\n"); const dataUrl="data:text/csv;charset=utf-8,"+encodeURIComponent(csv); downloadDataUrl(`bondyard_inventory_${new Date().toISOString().slice(0,10)}.csv`, dataUrl);
            }}>Export CSV</button>
            <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={()=>setCreating(true)}>+ New Vehicle</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        {loading && <div className="p-4">Loading…</div>}
        {error && <div className="p-4 text-red-600 text-sm">{String(error)}</div>}

        <div className="bg-white rounded-2xl p-4 shadow-sm border">
          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div className="flex gap-2 items-center">
              <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search VIN, make, model, stock #, location…" className="w-full md:w-96 h-10 px-3 rounded-xl border" />
              <div className="hidden md:block text-xs text-slate-500">{filtered.length} / {items.length} shown</div>
            </div>
            <div className="flex gap-2 flex-wrap">{["ALL","In Bond","Released","Sold","Hold"].map((s)=>(<Pill key={s} active={statusFilter===s} onClick={()=>setStatusFilter(s)}>{s}</Pill>))}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-4">
          {(!loading && filtered.length===0) && (
            <EmptyState title="No vehicles" subtitle="Add your first vehicle to start tracking inward/outward and documents." action={<div className="mt-4"><button className="px-4 py-2 rounded-xl bg-black text-white" onClick={()=>setCreating(true)}>Add Vehicle</button></div>} />
          )}

          {filtered.map((v)=> (
            <div key={v.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden">
              <div className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{v.year} {v.make} {v.model}</h2>
                    <Badge tone={(totalIn(v)-totalOut(v))>0?"green":"red"}>{(totalIn(v)-totalOut(v))>0?"In Stock":"Out"}</Badge>
                    <Badge tone={v.status==="In Bond"?"blue":v.status==="Sold"?"red":v.status==="Released"?"green":"amber"}>{v.status}</Badge>
                  </div>
                  <div className="text-sm text-slate-600 flex flex-wrap gap-3">
                    <span><b>VIN:</b> {v.vin||"—"}</span>
                    <span><b>Stock #:</b> {v.stockNo||"—"}</span>
                    <span><b>Color:</b> {v.color||"—"}</span>
                    <span><b>Location:</b> {v.location||"—"}</span>
                    <span><b>Supplier:</b> {v.supplier||"—"}</span>
                    <span><b>Buyer:</b> {v.buyer||"—"}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-2 rounded-xl border" onClick={()=>setEditing(v)}>Edit</button>
                  <button className="px-3 py-2 rounded-xl border text-red-600" onClick={()=>removeVehicle(v.id)}>Delete</button>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-0">
                <div className="md:col-span-2 border-t p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Stock Movements</h3>
                    <div className="text-sm text-slate-600">In: {totalIn(v)} · Out: {totalOut(v)} · On hand: <b>{totalIn(v)-totalOut(v)}</b></div>
                  </div>
                  <MovementForm onAdd={(m)=>addMovement(v.id, m)} />
                  {(v.movements||[]).length>0 ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full text-sm border"><thead className="bg-slate-50"><tr><th className="p-2 border">Date</th><th className="p-2 border">Type</th><th className="p-2 border">Qty</th><th className="p-2 border">Notes</th><th className="p-2 border">Action</th></tr></thead><tbody>
                        {v.movements.map((m)=>(
                          <tr key={m.id}><td className="p-2 border whitespace-nowrap">{fromISODate(m.date)}</td><td className="p-2 border">{m.type}</td><td className="p-2 border">{m.qty}</td><td className="p-2 border">{m.notes}</td><td className="p-2 border text-center"><button className="text-xs text-red-600 underline" onClick={()=>removeMovement(v.id, m.id)}>Remove</button></td></tr>
                        ))}
                      </tbody></table>
                    </div>
                  ) : (<p className="text-sm text-slate-500 mt-2">No movements yet.</p>)}
                </div>

                <div className="border-t md:border-l p-4">
                  <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">Attachments</h3><Badge tone="slate">{(v.attachments||[]).length}</Badge></div>
                  <AttachmentPicker onAdd={(files)=>addAttachments(v.id, files)} />
                  <div className="mt-3 space-y-2 max-h-64 overflow-auto pr-1">
                    {(v.attachments||[]).length===0 && (<p className="text-sm text-slate-500">No files. Upload purchase docs, release letters, photos, etc.</p>)}
                    {(v.attachments||[]).map((a)=> (
                      <div key={a.id} className="border rounded-xl p-2 flex items-center justify-between">
                        <div className="truncate max-w-[12rem]"><div className="text-sm font-medium truncate">{a.name}</div><div className="text-xs text-slate-500">{a.mime || "(file)"} · {a.size? (a.size/1024).toFixed(1)+" KB" : ""}</div></div>
                        <div className="flex gap-2">
                          <a className="text-xs underline" href={a.url || a.dataUrl} target="_blank" rel="noreferrer">Open</a>
                          <button className="text-xs text-red-600 underline" onClick={()=>removeAttachment(v.id, a.id)}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t p-4 bg-slate-50">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <label className="text-sm font-medium">Notes</label>
                    <textarea className="mt-1 w-full border rounded-xl p-3" rows={3} value={v.notes||""} onChange={(e)=>updateVehicle(v.id, { notes: e.target.value })} />
                  </div>
                  <div className="w-56 text-sm text-slate-600">
                    <div className="font-semibold mb-1">Dates</div>
                    <div className="space-y-2">
                      <div><div className="text-xs text-slate-500">In Date</div><input type="date" className="w-full h-10 px-3 rounded-xl border" value={fromISODate(v.inDate)} onChange={(e)=>updateVehicle(v.id, { inDate: toISODate(e.target.value) })} /></div>
                      <div><div className="text-xs text-slate-500">Out Date</div><input type="date" className="w-full h-10 px-3 rounded-xl border" value={fromISODate(v.outDate)} onChange={(e)=>updateVehicle(v.id, { outDate: toISODate(e.target.value) })} /></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {creating && (<Modal title="New Vehicle" onClose={()=>setCreating(false)}><VehicleForm onSubmit={addVehicle} onCancel={()=>setCreating(false)} /></Modal>)}
        {editing && (<Modal title={`Edit ${editing.year||''} ${editing.make||''} ${editing.model||''}`} onClose={()=>setEditing(null)}><VehicleForm initial={editing} onSubmit={(data)=>{ updateVehicle(editing.id, data); setEditing(null); }} onCancel={()=>setEditing(null)} /></Modal>)}
      </main>

      <footer className="max-w-7xl mx-auto px-4 py-10 text-center text-xs text-slate-500">Bond Yard Inventory · {USE_API?"Cloud API mode":"Local demo mode"}</footer>
    </div>
  );
}
