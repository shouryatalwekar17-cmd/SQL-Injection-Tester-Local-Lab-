import sqlite3

def init_db():
    # Connects to database.db (creates it if it doesn't exist yet)
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            password TEXT
        )
    """)
    
    # Add a default admin user for our lab
    cursor.execute("INSERT OR IGNORE INTO users (id, username, password) VALUES (1, 'admin', 'password123')")
    
    # Save changes and close connection
    conn.commit()
    conn.close()
    print("Database initialized successfully!")

if __name__ == "__main__":
    init_db()