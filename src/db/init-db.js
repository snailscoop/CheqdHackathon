// Videos and content
db.exec(`
  CREATE TABLE IF NOT EXISTS educational_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    overview TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cid TEXT UNIQUE,
    path TEXT,
    file_name TEXT,
    file_size INTEGER,
    duration REAL,
    format TEXT,
    status TEXT DEFAULT 'pending',
    has_frame_analysis BOOLEAN DEFAULT 0,
    frame_analysis_complete BOOLEAN DEFAULT 0,
    has_transcription BOOLEAN DEFAULT 0,
    has_summary BOOLEAN DEFAULT 0,
    has_quiz BOOLEAN DEFAULT 0,
    pdf_report_path TEXT,
    processing_error TEXT,
    topic TEXT,
    metadata TEXT
  );
`); 