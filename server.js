const express      = require('express');
const mongoose     = require('mongoose');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path         = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'university_secret_2024';

// ══ اتصال MongoDB ══
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ══ النماذج (Schemas) ══

const UserSchema = new mongoose.Schema({
  username:   { type: String, required: true, unique: true },
  password:   { type: String, required: true },
  fullName:   { type: String, required: true },
  role:       { type: String, enum: ['admin','editor','viewer'], default: 'viewer' },
  createdAt:  { type: Date, default: Date.now }
});

const StudentSchema = new mongoose.Schema({
  student_id:  { type: String, required: true },
  name:        { type: String, required: true },
  gender:      String,
  college:     String,
  major:       String,
  admit_year:  String,
  admit_type:  String,
  phone:       String,
  activity:    String,
  join_date:   String,
  createdAt:   { type: Date, default: Date.now }
});

const AchievementSchema = new mongoose.Schema({
  student_id:   { type: String, required: true },
  student_name: String,
  work:         { type: String, required: true },
  ach_date:     String,
  activity:     String,
  createdAt:    { type: Date, default: Date.now }
});

const User        = mongoose.model('User',        UserSchema);
const Student     = mongoose.model('Student',     StudentSchema);
const Achievement = mongoose.model('Achievement', AchievementSchema);

// ══ إنشاء المدير الافتراضي ══
async function createDefaultAdmin() {
  const exists = await User.findOne({ username: 'admin' });
  if (!exists) {
    const hashed = await bcrypt.hash('admin123', 10);
    await User.create({
      username: 'admin',
      password: hashed,
      fullName: 'مدير النظام',
      role:     'admin'
    });
    console.log('✅ Default admin created: admin / admin123');
  }
}
mongoose.connection.once('open', createDefaultAdmin);

// ══ Middleware ══
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  next();
});

// ══ التحقق من التوكن ══
function auth(roles = []) {
  return (req, res, next) => {
    const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'غير مصرح — يرجى تسجيل الدخول' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      if (roles.length && !roles.includes(decoded.role))
        return res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' });
      next();
    } catch {
      res.status(401).json({ error: 'انتهت صلاحية الجلسة — يرجى تسجيل الدخول مجدداً' });
    }
  };
}

// ══ API المصادقة ══

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  const token = jwt.sign(
    { id: user._id, username: user.username, fullName: user.fullName, role: user.role },
    JWT_SECRET, { expiresIn: '8h' }
  );
  res.cookie('token', token, { httpOnly: true, maxAge: 8*60*60*1000 });
  res.json({ token, user: { username: user.username, fullName: user.fullName, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'تم تسجيل الخروج' });
});

app.get('/api/auth/me', auth(), (req, res) => {
  res.json(req.user);
});

// ══ API المستخدمين (مدير فقط) ══

app.get('/api/users', auth(['admin']), async (req, res) => {
  const users = await User.find({}, '-password').sort('-createdAt');
  res.json(users);
});

app.post('/api/users', auth(['admin']), async (req, res) => {
  const { username, password, fullName, role } = req.body;
  if (!username || !password || !fullName || !role)
    return res.status(400).json({ error: 'يرجى ملء جميع الحقول' });
  const exists = await User.findOne({ username });
  if (exists) return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ username, password: hashed, fullName, role });
  res.json({ id: user._id, message: 'تم إنشاء المستخدم بنجاح' });
});

app.delete('/api/users/:id', auth(['admin']), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user?.username === 'admin')
    return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'تم حذف المستخدم' });
});

app.put('/api/users/:id/password', auth(['admin']), async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'يرجى إدخال كلمة المرور الجديدة' });
  const hashed = await bcrypt.hash(password, 10);
  await User.findByIdAndUpdate(req.params.id, { password: hashed });
  res.json({ message: 'تم تغيير كلمة المرور' });
});

// ══ API الطلبة ══

app.get('/api/students/lookup', auth(), async (req, res) => {
  const q = (req.query.q || '').trim();
  const r = await Student.findOne({ student_id: q });
  res.json(r || null);
});

app.get('/api/students', auth(), async (req, res) => {
  const { q, activity, college, gender } = req.query;
  const filter = {};
  if (activity) filter.activity = activity;
  if (college)  filter.college  = college;
  if (gender)   filter.gender   = gender;
  if (q) filter.$or = [
    { name:       { $regex: q, $options: 'i' } },
    { student_id: { $regex: q, $options: 'i' } },
    { college:    { $regex: q, $options: 'i' } }
  ];
  const students = await Student.find(filter).sort('-createdAt');
  res.json(students);
});

app.post('/api/students', auth(['admin','editor']), async (req, res) => {
  const { student_id,name,gender,college,major,admit_year,admit_type,phone,activity,join_date } = req.body;
  if (!student_id||!name||!gender||!college||!major||!admit_year||!activity||!join_date)
    return res.status(400).json({ error: 'يرجى ملء جميع الحقول الإلزامية' });
  const exists = await Student.findOne({ student_id, activity });
  if (exists) return res.status(400).json({ error: 'هذا الطالب مسجل بالفعل في هذا النشاط' });
  const student = await Student.create({ student_id,name,gender,college,major,admit_year,admit_type:admit_type||'',phone:phone||'',activity,join_date });
  res.json({ id: student._id, message: 'تم تسجيل الطالب بنجاح' });
});

app.delete('/api/students/:id', auth(['admin']), async (req, res) => {
  await Student.findByIdAndDelete(req.params.id);
  res.json({ message: 'تم الحذف' });
});

// ══ API الإنجازات ══

app.get('/api/achievements', auth(), async (req, res) => {
  const { q, activity } = req.query;
  const filter = {};
  if (activity) filter.activity = activity;
  if (q) filter.$or = [
    { student_name: { $regex: q, $options: 'i' } },
    { student_id:   { $regex: q, $options: 'i' } },
    { work:         { $regex: q, $options: 'i' } }
  ];
  const achievements = await Achievement.find(filter).sort('-createdAt');
  res.json(achievements);
});

app.post('/api/achievements', auth(['admin','editor']), async (req, res) => {
  const { student_id,student_name,work,ach_date,activity } = req.body;
  if (!student_id||!work||!ach_date)
    return res.status(400).json({ error: 'يرجى ملء الرقم الجامعي والإنجاز والتاريخ' });
  const ach = await Achievement.create({ student_id,student_name:student_name||'',work,ach_date,activity:activity||'' });
  res.json({ id: ach._id, message: 'تم إضافة الإنجاز بنجاح' });
});

app.delete('/api/achievements/:id', auth(['admin']), async (req, res) => {
  await Achievement.findByIdAndDelete(req.params.id);
  res.json({ message: 'تم الحذف' });
});

// ══ الإحصائيات ══

app.get('/api/stats', auth(), async (req, res) => {
  const [total_s, total_a, by_activity, recent] = await Promise.all([
    Student.countDocuments(),
    Achievement.countDocuments(),
    Student.aggregate([{ $group: { _id: '$activity', n: { $sum: 1 } } }]),
    Student.find().sort('-createdAt').limit(8)
  ]);
  const unique_s = (await Student.distinct('student_id')).length;
  res.json({
    total_s, unique_s, total_a,
    by_activity: by_activity.map(r => ({ activity: r._id, n: r.n })),
    recent
  });
});

// ══ الاستعلامات ══

app.get('/api/query/count', auth(), async (req, res) => {
  const { activity, from, to } = req.query;
  const filter = {};
  if (activity) filter.activity = activity;
  if (from || to) {
    filter.join_date = {};
    if (from) filter.join_date.$gte = from;
    if (to)   filter.join_date.$lte = to;
  }
  const rows  = await Student.find(filter).sort('-join_date');
  res.json({
    total:   rows.length,
    males:   rows.filter(r=>r.gender==='ذكر').length,
    females: rows.filter(r=>r.gender==='أنثى').length,
    rows
  });
});

app.get('/api/query/activity-ach', auth(), async (req, res) => {
  const { activity, from, to } = req.query;
  if (!activity) return res.status(400).json({ error: 'يرجى تحديد النشاط' });
  const filter = { activity };
  if (from || to) {
    filter.ach_date = {};
    if (from) filter.ach_date.$gte = from;
    if (to)   filter.ach_date.$lte = to;
  }
  const rows = await Achievement.find(filter).sort('-ach_date');
  res.json(rows);
});

// ══ تصدير CSV ══

app.get('/api/export/students', auth(), async (req, res) => {
  const rows = await Student.find().sort('-createdAt');
  const hdr  = ['الرقم الجامعي','الاسم','الجنس','الكلية','التخصص','سنة القبول','نوع القبول','الهاتف','النشاط','تاريخ الالتحاق'];
  const csv  = [hdr.join(','),...rows.map(r=>
    [r.student_id,r.name,r.gender,r.college,r.major,r.admit_year,r.admit_type,r.phone,r.activity,r.join_date]
    .map(v=>`"${(v||'').replace(/"/g,'""')}"`)
    .join(','))].join('\n');
  res.setHeader('Content-Type','text/csv;charset=utf-8');
  res.setHeader('Content-Disposition','attachment;filename=students.csv');
  res.send('\uFEFF'+csv);
});

app.get('/api/export/achievements', auth(), async (req, res) => {
  const rows = await Achievement.find().sort('-createdAt');
  const hdr  = ['الرقم الجامعي','اسم الطالب','الإنجاز','التاريخ','النشاط'];
  const csv  = [hdr.join(','),...rows.map(r=>
    [r.student_id,r.student_name,r.work,r.ach_date,r.activity]
    .map(v=>`"${(v||'').replace(/"/g,'""')}"`)
    .join(','))].join('\n');
  res.setHeader('Content-Type','text/csv;charset=utf-8');
  res.setHeader('Content-Disposition','attachment;filename=achievements.csv');
  res.send('\uFEFF'+csv);
});

// ══ تقديم الواجهة ══
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
