import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const db = new Database('school.db');
const JWT_SECRET = 'super-secret-key-change-this-in-prod';

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'staff'
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT UNIQUE,
    name TEXT,
    email TEXT,
    phone TEXT,
    dob TEXT,
    gender TEXT,
    address TEXT,
    class TEXT,
    section TEXT,
    enrollment_date TEXT
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    date TEXT,
    status TEXT,
    FOREIGN KEY(student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    subject TEXT,
    exam_type TEXT,
    marks_obtained INTEGER,
    total_marks INTEGER,
    date TEXT,
    FOREIGN KEY(student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    amount REAL,
    status TEXT,
    payment_date TEXT,
    description TEXT,
    FOREIGN KEY(student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS timetable (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class TEXT,
    day TEXT,
    subject TEXT,
    start_time TEXT,
    end_time TEXT,
    teacher TEXT
  );
`);

// Seed Admin User if not exists
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hashedPassword, 'admin');
}

// Seed Sample Students
const studentCount = db.prepare('SELECT COUNT(*) as count FROM students').get().count;
if (studentCount === 0) {
  const sampleStudents = [
    ['S1001', 'John Doe', 'john@example.com', '1234567890', '2005-05-15', 'Male', '123 Maple St', '10', 'A', '2023-09-01'],
    ['S1002', 'Jane Smith', 'jane@example.com', '0987654321', '2006-02-20', 'Female', '456 Oak Ave', '10', 'B', '2023-09-01'],
    ['S1003', 'Alex Johnson', 'alex@example.com', '1122334455', '2005-11-10', 'Non-binary', '789 Pine Rd', '11', 'A', '2023-09-01']
  ];
  const insert = db.prepare(`
    INSERT INTO students (student_id, name, email, phone, dob, gender, address, class, section, enrollment_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of sampleStudents) insert.run(...s);
  
  // Seed some fees
  db.prepare("INSERT INTO fees (student_id, amount, status, payment_date, description) VALUES (1, 500, 'Paid', '2024-01-10', 'Tuition Fee')").run();
  db.prepare("INSERT INTO fees (student_id, amount, status, payment_date, description) VALUES (2, 500, 'Pending', '', 'Tuition Fee')").run();
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // Auth Routes
  app.post('/api/register', (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }
    try {
      const hashedPassword = bcrypt.hashSync(password, 10);
      const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hashedPassword, role || 'staff');
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      if (e.message.includes('UNIQUE constraint failed')) {
        res.status(400).json({ message: 'Username already exists' });
      } else {
        res.status(500).json({ message: e.message });
      }
    }
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user: any = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (user && bcrypt.compareSync(password, user.password)) {
      const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  });

  // Student Routes
  app.get('/api/students', authenticateToken, (req, res) => {
    const students = db.prepare('SELECT * FROM students').all();
    res.json(students);
  });

  app.post('/api/students', authenticateToken, (req, res) => {
    const { student_id, name, email, phone, dob, gender, address, class: className, section, enrollment_date } = req.body;
    try {
      const result = db.prepare(`
        INSERT INTO students (student_id, name, email, phone, dob, gender, address, class, section, enrollment_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(student_id, name, email, phone, dob, gender, address, className, section, enrollment_date);
      res.json({ id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put('/api/students/:id', authenticateToken, (req, res) => {
    const { student_id, name, email, phone, dob, gender, address, class: className, section } = req.body;
    db.prepare(`
      UPDATE students SET student_id = ?, name = ?, email = ?, phone = ?, dob = ?, gender = ?, address = ?, class = ?, section = ?
      WHERE id = ?
    `).run(student_id, name, email, phone, dob, gender, address, className, section, req.params.id);
    res.json({ success: true });
  });

  app.delete('/api/students/:id', authenticateToken, (req, res) => {
    db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // Attendance Routes
  app.get('/api/attendance', authenticateToken, (req, res) => {
    const { date } = req.query;
    const attendance = db.prepare(`
      SELECT a.*, s.name, s.student_id as sid 
      FROM attendance a 
      JOIN students s ON a.student_id = s.id 
      WHERE a.date = ?
    `).all(date);
    res.json(attendance);
  });

  app.post('/api/attendance', authenticateToken, (req, res) => {
    const { records, date } = req.body; // records: [{student_id, status}]
    const insert = db.prepare('INSERT OR REPLACE INTO attendance (student_id, date, status) VALUES (?, ?, ?)');
    const transaction = db.transaction((recs) => {
      for (const rec of recs) insert.run(rec.student_id, date, rec.status);
    });
    transaction(records);
    res.json({ success: true });
  });

  // Marks Routes
  app.get('/api/marks/:studentId', authenticateToken, (req, res) => {
    const marks = db.prepare('SELECT * FROM marks WHERE student_id = ?').all(req.params.studentId);
    res.json(marks);
  });

  app.post('/api/marks', authenticateToken, (req, res) => {
    const { student_id, subject, exam_type, marks_obtained, total_marks, date } = req.body;
    db.prepare(`
      INSERT INTO marks (student_id, subject, exam_type, marks_obtained, total_marks, date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(student_id, subject, exam_type, marks_obtained, total_marks, date);
    res.json({ success: true });
  });

  // Fees Routes
  app.get('/api/fees', authenticateToken, (req, res) => {
    const fees = db.prepare(`
      SELECT f.*, s.name, s.student_id as sid 
      FROM fees f 
      JOIN students s ON f.student_id = s.id
    `).all();
    res.json(fees);
  });

  app.post('/api/fees', authenticateToken, (req, res) => {
    const { student_id, amount, status, payment_date, description } = req.body;
    db.prepare(`
      INSERT INTO fees (student_id, amount, status, payment_date, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(student_id, amount, status, payment_date, description);
    res.json({ success: true });
  });

  // Timetable Routes
  app.get('/api/timetable/:class', authenticateToken, (req, res) => {
    const timetable = db.prepare('SELECT * FROM timetable WHERE class = ?').all(req.params.class);
    res.json(timetable);
  });

  app.post('/api/timetable', authenticateToken, (req, res) => {
    const { class: className, day, subject, start_time, end_time, teacher } = req.body;
    db.prepare(`
      INSERT INTO timetable (class, day, subject, start_time, end_time, teacher)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(className, day, subject, start_time, end_time, teacher);
    res.json({ success: true });
  });

  // Dashboard Stats
  app.get('/api/stats', authenticateToken, (req, res) => {
    const totalStudents = db.prepare('SELECT COUNT(*) as count FROM students').get().count;
    const totalFees = db.prepare("SELECT SUM(amount) as total FROM fees WHERE status = 'Paid'").get().total || 0;
    const recentAttendance = db.prepare("SELECT COUNT(*) as count FROM attendance WHERE date = date('now') AND status = 'Present'").get().count;
    res.json({ totalStudents, totalFees, recentAttendance });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(3000, '0.0.0.0', () => {
    console.log('Server running on http://localhost:3000');
  });
}

startServer();
