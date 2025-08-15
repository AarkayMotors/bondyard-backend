// server.js — Bond Yard Inventory Backend (Express + SQLite + optional S3)
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";           // requires the `sqlite` package (see package.json)
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8080;
const STORAGE_MODE = (process.env.STORAGE_MODE || "local").toLowerCase();
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (STORAGE_MODE === "local") fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));

// --- DB ---
let db;
(async () => {
  db = await open({ filename: path.join(__dirname, "bondyard.db"), driver: sqlite3.Database });
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      vin TEXT NOT NULL,
      stockNo TEXT,
      make TEXT,
      model TEXT,
      year TEXT,
      color TEXT,
      location TEXT,
      status TEXT,
      supplier TEXT,
      buyer TEXT,
      inDate TEXT,
      outDate TEXT,
      notes TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS movements (
      id TEXT PRIMARY KEY,
      vehicleId TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('INWARD','OUTWARD')),
      date TEXT,
      qty TEXT,
      notes TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (vehicleId) REFERENCES vehicles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      vehicleId TEXT NOT NULL,
      name TEXT,
      mime TEXT,
      size INTEGER,
      url TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (vehicleId) REFERENCES vehicles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_movements_vehicle ON movements(vehicleId);
    CREATE INDEX IF NOT EXISTS idx_attachments_vehicle ON attachments(vehicleId);
  `);
})();

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// --- S3 ---
let s3;
if (STORAGE_MODE === "s3") s3 = new S3Client({ region: process.env.AWS_REGION });

async function saveFile(file) {
  if (STORAGE_MODE === "s3") {
    const Key = `bondyard/${Date.now()}_${file.originalname}`.replace(/\s+/g, "_");
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key,
      Body: fs.readFileSync(file.path),
      ContentType: file.mimetype
    }));
    const url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${Key}`;
    fs.unlinkSync(file.path);
    return url;
  } else {
    return `/uploads/${path.basename(file.path)}`;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`.replace(/\s+/g, "_")),
});
const upload = multer({ storage });

async function withChildren(vehicle) {
  const movements = await db.all("SELECT * FROM movements WHERE vehicleId=? ORDER BY date ASC, createdAt ASC", vehicle.id);
  const attachments = await db.all("SELECT * FROM attachments WHERE vehicleId=? ORDER BY createdAt DESC", vehicle.id);
  return { ...vehicle, movements, attachments };
}

// --- ROUTES ---
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/vehicles", async (req, res) => {
  const q = (req.query.q || "").toString().toLowerCase();
  const status = (req.query.status || "").toString();
  const vs = await db.all("SELECT * FROM vehicles ORDER BY updatedAt DESC");
  let filtered = vs;
  if (q) {
    filtered = filtered.filter(v =>
      [v.vin, v.stockNo, v.make, v.model, v.year, v.color, v.location, v.supplier, v.buyer]
        .filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }
  if (status && status !== "ALL") filtered = filtered.filter(v => v.status === status);
  const out = await Promise.all(filtered.map(withChildren));
  res.json(out);
});

app.post("/api/vehicles", async (req, res) => {
  const v = req.body || {};
  const id = v.id || uid();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO vehicles (id, vin, stockNo, make, model, year, color, location, status, supplier, buyer, inDate, outDate, notes, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, v.vin, v.stockNo, v.make, v.model, String(v.year ?? ""), v.color, v.location, v.status, v.supplier, v.buyer, v.inDate, v.outDate, v.notes, now, now]
  );
  if (!Array.isArray(v.movements) || v.movements.length === 0) {
    await db.run(
      `INSERT INTO movements (id, vehicleId, type, date, qty, notes) VALUES (?,?,?,?,?,?)`,
      [uid(), id, "INWARD", v.inDate || now, String(v.qty ?? "1"), "Initial stock"]
    );
  } else {
    for (const m of v.movements) {
      await db.run(
        `INSERT INTO movements (id, vehicleId, type, date, qty, notes) VALUES (?,?,?,?,?,?)`,
        [m.id || uid(), id, m.type, m.date, String(m.qty ?? ""), m.notes]
      );
    }
  }
  const created = await db.get("SELECT * FROM vehicles WHERE id=?", id);
  res.status(201).json(await withChildren(created));
});

app.put("/api/vehicles/:id", async (req, res) => {
  const id = req.params.id;
  const v = req.body || {};
  const current = await db.get("SELECT * FROM vehicles WHERE id=?", id);
  if (!current) return res.status(404).json({ error: "Not found" });
  const merged = { ...current, ...v, updatedAt: new Date().toISOString() };
  await db.run(
    `UPDATE vehicles SET vin=?, stockNo=?, make=?, model=?, year=?, color=?, location=?, status=?, supplier=?, buyer=?, inDate=?, outDate=?, notes=?, updatedAt=? WHERE id=?`,
    [merged.vin, merged.stockNo, merged.make, merged.model, String(merged.year ?? ""), merged.color, merged.location, merged.status, merged.supplier, merged.buyer, merged.inDate, merged.outDate, merged.notes, merged.updatedAt, id]
  );
  if (Array.isArray(v.movements)) {
    await db.run("DELETE FROM movements WHERE vehicleId=?", id);
    for (const m of v.movements) {
      await db.run(
        `INSERT INTO movements (id, vehicleId, type, date, qty, notes) VALUES (?,?,?,?,?,?)`,
        [m.id || uid(), id, m.type, m.date, String(m.qty ?? ""), m.notes]
      );
    }
  }
  const updated = await db.get("SELECT * FROM vehicles WHERE id=?", id);
  res.json(await withChildren(updated));
});

app.delete("/api/vehicles/:id", async (req, res) => {
  await db.run("DELETE FROM vehicles WHERE id=?", req.params.id);
  res.json({ ok: true });
});

app.post("/api/vehicles/:id/movements", async (req, res) => {
  const id = req.params.id;
  const m = req.body || {};
  const mid = m.id || uid();
  await db.run(
    `INSERT INTO movements (id, vehicleId, type, date, qty, notes) VALUES (?,?,?,?,?,?)`,
    [mid, id, m.type, m.date, String(m.qty ?? ""), m.notes]
  );
  const vehicle = await db.get("SELECT * FROM vehicles WHERE id=?", id);
  res.status(201).json(await withChildren(vehicle));
});

app.delete("/api/vehicles/:id/movements/:mid", async (req, res) => {
  await db.run("DELETE FROM movements WHERE id=? AND vehicleId=?", req.params.mid, req.params.id);
  const vehicle = await db.get("SELECT * FROM vehicles WHERE id=?", req.params.id);
  res.json(await withChildren(vehicle));
});

app.post("/api/vehicles/:id/attachments", upload.array("files", 10), async (req, res) => {
  const id = req.params.id;
  const files = req.files || [];
  const out = [];
  for (const f of files) {
    const url = await saveFile(f);
    const aid = uid();
    await db.run(
      `INSERT INTO attachments (id, vehicleId, name, mime, size, url) VALUES (?,?,?,?,?,?)`,
      [aid, id, f.originalname, f.mimetype, f.size, url]
    );
    out.push({ id: aid, name: f.originalname, mime: f.mimetype, size: f.size, url });
  }
  res.status(201).json(out);
});

app.delete("/api/vehicles/:id/attachments/:aid", async (req, res) => {
  await db.run("DELETE FROM attachments WHERE id=? AND vehicleId=?", req.params.aid, req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Bond Yard backend running on :${PORT}`);
});
