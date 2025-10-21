import Database from "better-sqlite3";

export class FeedbackStore {
  private db: Database;

  constructor(path = "memory.db") {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        user_id TEXT,
        question TEXT,
        answer TEXT,
        reaction TEXT,
        comment TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.db.exec(`
    CREATE TABLE IF NOT EXISTS engagement (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        user_id TEXT,
        user_message TEXT,
        bot_response TEXT,
        signal TEXT, -- e.g., "follow-up", "thanks", "repeat", "abandon"
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);
  }

  saveFeedback(data: {
    thread_id: string;
    user_id: string;
    question: string;
    answer: string;
    reaction: string;
    comment?: string;
  }) {
    this.db.prepare(`
      INSERT INTO feedback (thread_id, user_id, question, answer, reaction, comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.thread_id,
      data.user_id,
      data.question,
      data.answer,
      data.reaction,
      data.comment ?? null
    );
  }

  logEngagement(data: {
    thread_id: string;
    user_id: string;
    user_message: string;
    bot_response: string;
    signal: string;
 }) {
  this.db.prepare(`
    INSERT INTO engagement (thread_id, user_id, user_message, bot_response, signal)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    data.thread_id,
    data.user_id,
    data.user_message,
    data.bot_response,
    data.signal
  );
}


  getHighRatedExamples(user_id: string): { question: string; answer: string }[] {
    return this.db.prepare(`
      SELECT question, answer FROM feedback
      WHERE user_id = ? AND reaction >= 'like'
      ORDER BY timestamp DESC
      LIMIT 5
    `).all(user_id);
  }
}