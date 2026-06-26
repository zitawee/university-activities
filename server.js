const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const init = { students: [], achievements: [], next_s: 1, next_a: 1 };
      fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), 'utf8');
      return init;
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch(e) { return { students: [], achievements: [], next_s: 1, next_a: 1 }; }
}

function writeDB(data) {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8'); return true; }
  catch(e) { return false; }
}

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ══ API الطلبة ══
app.get('/api/students/lookup', (req, res) => {
  const q = (req.query.q||'').trim();
  const r = readDB().students.find(s => s.student_id === q);
  res.json(r || null);
});

app.get('/api/students', (req, res) => {
  const { q, activity, college, gender } = req.query;
  let list = readDB().students;
  if (q)        list = list.filter(s => s.name.includes(q)||s.student_id.includes(q)||(s.college||'').includes(q));
  if (activity) list = list.filter(s => s.activity === activity);
  if (college)  list = list.filter(s => s.college  === college);
  if (gender)   list = list.filter(s => s.gender   === gender);
  res.json([...list].reverse());
});

app.post('/api/students', (req, res) => {
  const { student_id,name,gender,college,major,admit_year,admit_type,phone,activity,join_date } = req.body;
  if (!student_id||!name||!gender||!college||!major||!admit_year||!activity||!join_date)
    return res.status(400).json({ error: 'يرجى ملء جميع الحقول الإلزامية' });
  const db = readDB();
  if (db.students.find(s=>s.student_id===student_id&&s.activity===activity))
    return res.status(400).json({ error: 'هذا الطالب مسجل بالفعل في هذا النشاط' });
  const record = { id:db.next_s++,student_id,name,gender,college,major,
    admit_year,admit_type:admit_type||'',phone:phone||'',activity,join_date,
    created_at:new Date().toISOString() };
  db.students.push(record);
  if (!writeDB(db)) return res.status(500).json({ error: 'فشل حفظ البيانات' });
  res.json({ id:record.id, message:'تم تسجيل الطالب بنجاح' });
});

app.delete('/api/students/:id', (req, res) => {
  const db = readDB();
  db.students = db.students.filter(s=>s.id!==parseInt(req.params.id));
  writeDB(db); res.json({ message:'تم الحذف' });
});

// ══ API الإنجازات ══
app.get('/api/achievements', (req, res) => {
  const { q, activity } = req.query;
  let list = readDB().achievements;
  if (q)        list = list.filter(a=>(a.student_name||'').includes(q)||a.student_id.includes(q)||a.work.includes(q));
  if (activity) list = list.filter(a=>a.activity===activity);
  res.json([...list].reverse());
});

app.post('/api/achievements', (req, res) => {
  const { student_id,student_name,work,ach_date,activity } = req.body;
  if (!student_id||!work||!ach_date)
    return res.status(400).json({ error: 'يرجى ملء الرقم الجامعي والإنجاز والتاريخ' });
  const db = readDB();
  const record = { id:db.next_a++,student_id,student_name:student_name||'',
    work,ach_date,activity:activity||'',created_at:new Date().toISOString() };
  db.achievements.push(record);
  if (!writeDB(db)) return res.status(500).json({ error: 'فشل حفظ البيانات' });
  res.json({ id:record.id, message:'تم إضافة الإنجاز بنجاح' });
});

app.delete('/api/achievements/:id', (req, res) => {
  const db = readDB();
  db.achievements = db.achievements.filter(a=>a.id!==parseInt(req.params.id));
  writeDB(db); res.json({ message:'تم الحذف' });
});

// ══ الإحصائيات ══
app.get('/api/stats', (req, res) => {
  const db = readDB();
  const unique_ids  = new Set(db.students.map(s=>s.student_id));
  const by_act_map  = {};
  db.students.forEach(s=>{ by_act_map[s.activity]=(by_act_map[s.activity]||0)+1; });
  res.json({
    total_s: db.students.length, unique_s: unique_ids.size, total_a: db.achievements.length,
    by_activity: Object.entries(by_act_map).map(([activity,n])=>({activity,n})),
    recent: [...db.students].reverse().slice(0,8)
  });
});

// ══ الاستعلامات ══
app.get('/api/query/count', (req, res) => {
  const { activity,from,to } = req.query;
  let list = readDB().students;
  if (activity) list = list.filter(s=>s.activity===activity);
  if (from)     list = list.filter(s=>s.join_date>=from);
  if (to)       list = list.filter(s=>s.join_date<=to);
  res.json({ total:list.length, males:list.filter(s=>s.gender==='ذكر').length,
    females:list.filter(s=>s.gender==='أنثى').length, rows:list });
});

app.get('/api/query/activity-ach', (req, res) => {
  const { activity,from,to } = req.query;
  if (!activity) return res.status(400).json({ error:'يرجى تحديد النشاط' });
  let list = readDB().achievements.filter(a=>a.activity===activity);
  if (from) list = list.filter(a=>a.ach_date>=from);
  if (to)   list = list.filter(a=>a.ach_date<=to);
  res.json([...list].reverse());
});

// ══ تصدير CSV ══
app.get('/api/export/students', (req, res) => {
  const rows = readDB().students;
  const hdr  = ['الرقم الجامعي','الاسم','الجنس','الكلية','التخصص','سنة القبول','نوع القبول','الهاتف','النشاط','تاريخ الالتحاق'];
  const csv  = [hdr.join(','),...rows.map(r=>
    [r.student_id,r.name,r.gender,r.college,r.major,r.admit_year,r.admit_type,r.phone,r.activity,r.join_date]
    .map(v=>`"${(v||'').replace(/"/g,'""')}"`)
    .join(','))].join('\n');
  res.setHeader('Content-Type','text/csv;charset=utf-8');
  res.setHeader('Content-Disposition','attachment;filename=students.csv');
  res.send('\uFEFF'+csv);
});

app.get('/api/export/achievements', (req, res) => {
  const rows = readDB().achievements;
  const hdr  = ['الرقم الجامعي','اسم الطالب','الإنجاز','التاريخ','النشاط'];
  const csv  = [hdr.join(','),...rows.map(r=>
    [r.student_id,r.student_name,r.work,r.ach_date,r.activity]
    .map(v=>`"${(v||'').replace(/"/g,'""')}"`)
    .join(','))].join('\n');
  res.setHeader('Content-Type','text/csv;charset=utf-8');
  res.setHeader('Content-Disposition','attachment;filename=achievements.csv');
  res.send('\uFEFF'+csv);
});

// ══ تشغيل الخادم ══
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
