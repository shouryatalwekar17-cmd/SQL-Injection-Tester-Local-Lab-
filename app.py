from flask import Flask, request, render_template_string
import sqlite3

app = Flask(__name__)

# Basic HTML login form displayed on the browser
LOGIN_HTML = """
<!DOCTYPE html>
<html>
<head><title>SQLi Lab Login</title></head>
<body>
    <h2>Login Page</h2>
    <form method="POST" action="/login">
        <label>Username:</label><br>
        <input type="text" name="username"><br><br>
        <label>Password:</label><br>
        <input type="password" name="password"><br><br>
        <input type="submit" value="Login">
    </form>
</body>
</html>
"""

# MODE TOGGLE: 
# Set to False to test the VULNERABLE route
# Set to True later to test the FIXED/SECURE route
USE_SECURE_QUERY = True

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template_string(LOGIN_HTML)
    
    username = request.form.get("username", "")
    password = request.form.get("password", "")
    
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    
    try:
        if not USE_SECURE_QUERY:
            # ❌ VULNERABLE: Direct string interpolation lets raw input change the query logic
            query = f"SELECT * FROM users WHERE username = '{username}' AND password = '{password}'"
            cursor.execute(query)
        else:
            # ✅ SECURE: Parameterized query treats input strictly as plain data
            query = "SELECT * FROM users WHERE username = ? AND password = ?"
            cursor.execute(query, (username, password))
            
        user = cursor.fetchone()
        conn.close()
        
        if user:
            return f"Welcome back, {user[1]}!"
        else:
            return "Login Failed: Invalid credentials"
            
    except sqlite3.Error as e:
        conn.close()
        return f"Database Error: {e}", 500

if __name__ == "__main__":
    app.run(port=5000, debug=True)