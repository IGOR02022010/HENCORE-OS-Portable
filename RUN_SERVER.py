import http.server
import socketserver
import os
import sys
import html
import shutil
import importlib.util
import urllib.parse
import socket
import ssl
import subprocess
from datetime import datetime


PORT = 3646
LOG_FILE = ".DATA_CHAT.txt"
ANDROID_ROOT = os.path.abspath(os.path.dirname(__file__)) if __file__ else os.getcwd()

CERT_FILE = "cert.pem"
KEY_FILE = "key.pem"
DESKTOP_UI = "Desktop_UI"  

def ensure_module(module_name, pip_name=None):

    if importlib.util.find_spec(module_name) is not None:
        return True
    pip_name = pip_name or module_name
    print(f"[i] Библиотека '{pip_name}' не найдена. Устанавливаю...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", pip_name], check=True)
        return importlib.util.find_spec(module_name) is not None
    except Exception as e:
        print(f"[!] Не удалось установить '{pip_name}': {e}")
        return False


def ensure_openssl():
    
    if shutil.which("openssl"):
        return True
    print("[i] Утилита openssl не найдена. Пробую установить через пакетный менеджер...")
    try:
        if shutil.which("pkg"):  # Termux
            subprocess.run(["pkg", "install", "-y", "openssl-tool"], check=True)
        elif shutil.which("apt"):
            subprocess.run(["apt", "install", "-y", "openssl"], check=True)
        elif shutil.which("apk"):
            subprocess.run(["apk", "add", "-y", "openssl"], check=False)
    except Exception as e:
        print(f"[!] Пакетный менеджер не сработал: {e}")
    return shutil.which("openssl") is not None


def ensure_cert():
    
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return True

    if ensure_openssl():
        subprocess.run([
            "openssl", "req", "-new", "-x509",
            "-keyout", KEY_FILE, "-out", CERT_FILE,
            "-days", "365", "-nodes",
            "-subj", "/CN=localhost"
        ], check=True)
        return True

    
    print("[i] Генерирую сертификат средствами pyOpenSSL...")
    if not ensure_module("OpenSSL", "pyOpenSSL"):
        raise SystemExit("[!] Нужен либо openssl, либо pip install pyOpenSSL")

    from OpenSSL import crypto
    key = crypto.PKey()
    key.generate_key(crypto.TYPE_RSA, 2048)
    cert = crypto.X509()
    cert.get_subject().CN = "localhost"
    cert.set_serial_number(1)
    cert.gmtime_adj_notBefore(0)
    cert.gmtime_adj_notAfter(365 * 24 * 60 * 60)
    cert.set_issuer(cert.get_subject())
    cert.set_pubkey(key)
    cert.sign(key, "sha256")
    with open(CERT_FILE, "wb") as f:
        f.write(crypto.dump_certificate(crypto.FILETYPE_PEM, cert))
    with open(KEY_FILE, "wb") as f:
        f.write(crypto.dump_privatekey(crypto.FILETYPE_PEM, key))
    print(f"[i] Сертификат создан: {CERT_FILE}, {KEY_FILE}")
    return True




print("[i] Проверка зависимостей...")
if not ensure_cert():
    raise SystemExit("[!] Не удалось создать сертификат")
print("[i] Все зависимости на месте, запускаюсь.\n")




if os.path.exists(LOG_FILE):
    with open(LOG_FILE, "r", encoding="utf-8") as f:
        chat_messages = f.readlines()
else:
    chat_messages = []


class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class IIA_Ultimate_Handler(http.server.SimpleHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  

    def do_GET(self):
        if self.path == "/chat" or self.path == "/":
            self.show_main_interface()
        elif self.path == "/chat_inter":
            self.show_chat_inter()
        elif self.path == "/menu":
            self.show_menu()
        elif self.path == "/storage":
            self.path = "/"
            return super().do_GET()
        elif self.path.startswith("/search"):
            self.show_search()
        else:
            return super().do_GET()

    def do_POST(self):
        if self.path == "/send":
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8', errors='replace')
            params = urllib.parse.parse_qs(post_data)

            user_name = params.get('name', ['Пользователь'])[0][:10]
            user_msg = params.get('msg', [''])[0]
            time_now = datetime.now().strftime("%H:%M")

            if user_msg:
            
                safe_name = html.escape(user_name)
                safe_msg = html.escape(user_msg)
                full_msg = f"[{time_now}] <b>{safe_name}:</b> {safe_msg}\n"
                chat_messages.append(full_msg)

                with open(LOG_FILE, "a", encoding="utf-8") as f:
                    f.write(full_msg)

                while len(chat_messages) > 2000:
                    chat_messages.pop(0)

            self.send_response(303)
            self.send_header("Location", "/chat_inter")
            self.end_headers()

    def show_main_interface(self):
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.end_headers()

        html_page = f"""
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>|NWS_959.DIRECT|</title>
            <style>
                body {{ font-family: sans-serif; background: black; color: #f0f0f0; margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; }}
                .container {{ text-align: center; background: black; padding: 30px; border-radius: 6px; width: 90%; max-width: 400px; border-top: 3px solid #f0f0f0; border-left: 1px solid #c0c0c0; border-right: 1px solid #c0c0c0; border-bottom: 1px solid #c0c0c0; }}
                h1 {{ color: #f0f0f0; font-size: 32px; margin-bottom: 5px; }}
                hr {{ border: 1px solid rgba(0,0,0,0.0); background: #272727 }}
                h2 {{ color: #c0c0c0; font-size: 16px; margin-bottom: 30px; }}
                .btn {{
                    display: block;
                    padding: 15px;
                    background: rgba(255,255,255, 0.2);
                    color: #f0f0f0;
                    text-decoration: none;
                    border: 1px solid #929292;
                    border-radius: 3px;
                    margin: 5px 2px;
                    font-weight: bold;
                }}
                .btn:hover {{
                    background: rgba(200,200,200, 0.2);
                }}
                .chat-open {{ background: black; border-color: black; }}
            </style>
        </head>
        <body>
        <div style="border-radius: 4px">
            <div class="container">
               <h1>General Intranet Server</h1><br>
               <h2>Начальная страница HENCORE Intraneta</h2><br>
               <hr>
               <br>
               <a class="btn" href="index.html">[Запусить_HENCORE_OS_(→)]</a><br>
               <a class="btn" href="/chat_inter">[Перейти_в_чат_(→)]</a><br>
               <a class="btn" href="/storage">[Перейти_в_хранилище_(→)]</a><br>
               <a href="javascript:void(0);" onclick="window.location.reload();" class="btn">[Перезагрузить_страницу_(→)]</a>
               <br>
               <hr>
            </div>
        </div>
        </body>
        </html>
        """
        self.wfile.write(html_page.encode('utf-8'))

    def show_chat_inter(self):
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.end_headers()

        messages_html = "".join(
            [f"<div style='border-bottom:1px solid black; padding:8px;'> {m.rstrip(chr(10))}</div>" for m in chat_messages]
        )

        html_page = f"""
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>|CHAT|</title>
            <style>
                body {{ font-family: sans-serif; background: black; color: #4900FF; margin: 0; }}
                .chat-container {{ max-width: 600px; margin: auto; display: flex; flex-direction: column; height: 100vh; }}
                .header {{ background: black; padding: 10px; border-bottom: 2px solid blue; display: flex; justify-content: space-between; align-items: center; }}
                .messages {{ flex-grow: 1; overflow-y: auto; background: #222; padding: 10px; font-size: 14px; color: #b9a0ff; }}
                .footer {{ background: black; padding: 10px; border-top: 1px solid #101010; }}
                input[type="text"] {{ width: 100%; padding: 12px; margin-bottom: 8px; border-radius: 5px; border: none; background: #444; color: white; box-sizing: border-box; }}
                .btn-row {{ display: flex; gap: 5px; }}
                .send-btn {{ flex-grow: 2; background: black; color: blue; border: none; padding: 10px; border-radius: 3px; font-weight: bold; cursor: pointer; }}
                .fold-btn {{ background: black; color: blue; text-decoration: none; padding: 10px 15px; border-radius: 3px; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="chat-container">
                <div class="header">
                    <span style="color:#5B0BFF; font-weight:bold;">@ CHAT:</span>
                    <a href="javascript:void(0);" onclick="window.location.reload();" class="fold-btn">[*] RESET</a>
                    <a href="/chat" class="fold-btn">[×] HOME</a>
                </div>
                <div class="messages" id="msg_box">{messages_html}</div>
                <div class="footer">
                    <form action="/send" method="post">
                        <input type="text" name="name" placeholder="▶/NIKNAME:____" maxlength="10">
                        <input type="text" name="msg" placeholder="▶/TEXT:____" required autofocus>
                        <div class="btn-row">
                            <input type="submit" class="send-btn" value="« ENTER [>]»">
                        </div>
                    </form>
                </div>
            </div>
            <script>
                var objDiv = document.getElementById("msg_box");
                objDiv.scrollTop = objDiv.scrollHeight;
            </script>
        </body>
        </html>
        """
        self.wfile.write(html_page.encode('utf-8'))

    def show_menu(self):
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.end_headers()
        html_page = f"""
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>|NWS_959 MENU LIST|</title>
            <style>
                body {{ font-family: sans-serif; background: black; color: #4A09FF; }}
                .container {{ max-width: 500px; margin: auto; background: black; padding: 20px; border-radius: 10px; text-align: center; border: 1px solid #171717;}}
                .btn {{ display: block; padding: 12px; background: #171717; color: #5A00FF; text-decoration: none; border: 1px solid #161616; border-radius: 3px; margin: 8px 0; }}
                input[type="text"] {{ width: 80%; padding: 10px; border-radius: 5px; border: none; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h2 style="color: #393939; background: none; border: 1px solid #171717;"> » [MENU]:</h2>
                <form action="/search" method="get">
                    <input type="text" name="q" placeholder="Поиск файлов на сервере...">
                    <input type="submit" value="»" style="padding:10px; background: black; border: 1px solid #393939;">
                </form>
                <br>
                <p>▶ [#] [NWS_959]: ◀ </p>
                <a style="border: 1px solid blue; background: #161616;" href="/chat" class="btn"> [×] |HOME_LIST| </a>
                <a style="border: 1px solid blue;" href="/storage" class="btn"> [/] |SERVER_STORAGE|</a>
                <br>
                <hr>
                <p>▶ [/_] [PROGRAMMS]: ◀</p>
                <p style="color:blue"> [▶Apps◀]: </p>
                <a style="border: 1px solid blue;" href="/{DESKTOP_UI}.htm" class="btn">[_] ▶|HENKOR_WebOS|◀</a>
                <br>
                <hr>
                <p style="color:#D2D2D2; border: 1px solid #555;"> ▶ [->] [INTERNET]: ◀ </p>
                <p style="color:blue"> [▶Online◀]: </p>
                <div style="display: flex; justify-content: space-around; flex-wrap: wrap; background: #303030; color: white; border: 2px solid blue;">
                    <a style="border: 1px solid blue; width: 40%;" href="https://www.google.com" class="btn">[🌐] Google</a>
                    <a style="border: 1px solid blue; width: 40%;" href="https://ya.ru" class="btn">[🌍] Yandex</a>
                    <a style="border: 1px solid blue; width: 40%;" href="https://web.telegram.org/k/" class="btn">[💬] Telegram</a>
                    <a style="border: 1px solid blue; width: 40%;" href="https://alice.yandex.ru/chat/" class="btn">[🎭] Alice</a>
                    <a style="border: 1px solid blue; width: 40%;" href="https://apkpure.com/" class="btn">[💽] Apkpure</a>
                    <a style="border: 1px solid blue; width: 40%;" href="https://www.instagram.com/?utm_source=op_m_sd" class="btn">[📷] Instagram</a>
                    <a style="border: 1px solid blue; width: 40%;" href="https://call2friends.com/free-calls" class="btn">[☎] Телефон</a>
                    <a style="border: 1px solid blue; width: 40%;" href="https://mail.google.com/mail/?authuser=0" class="btn">[✉] Gmail</a>
                    <a style="border: 1px solid blue; width: 40%;" href="http://chatbotchatapp.com/" class="btn">[💭] Chat GPT</a>
                    <a style="border: 1px solid blue; width: 40%;" href="https://yandex.ru/pogoda/?lat=55.030199&lon=82.92043" class="btn">[🌦] Погода</a>
                </div>
                <p style="color:#187754"> |▶     END     ◀|
            </div>
        </body>
        </html>
        """
        self.wfile.write(html_page.encode('utf-8'))

    def show_search(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('q', [''])[0].lower()
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.end_headers()
        results = []
        if query:
            for root, dirs, files in os.walk(ANDROID_ROOT):
                for name in files:
                    if query in name.lower():
                        rel_path = os.path.relpath(os.path.join(root, name), ANDROID_ROOT).replace(os.sep, "/")
                        results.append(
                            f"<li><a style='color:blue' href='/{urllib.parse.quote(rel_path)}'>{html.escape(rel_path)}</a></li>"
                        )
        res_html = "".join(results) if results else "[×] [Ничего не найдено по вашему запросу]"
        html_page = (
            "<html><body style='background:black; color:#00D2BB;'>"
            f"<div style='padding:20px;'><h2>RESULT: {html.escape(query)}</h2>"
            f"<ul>{res_html}</ul><br>"
            "<a href='/menu' style='color:white'>[⤴] [Назад в меню]</a></div>"
            "</body></html>"
        )
        self.wfile.write(html_page.encode('utf-8'))


def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


local_ip = get_ip()
print()
print("_" * 59)
print("            [/_] \\|SERVER_CONTROL_LIST|/")
print("=" * 59)
print("                  NWS_959 SGO STATUS: ")
print(f"[i] HTTP_HOME.LIST.URL: https://localhost:{PORT}/chat")
print("[i] SERVER_LINK_STATUS: ON")
print("[i] SERVER_NAME: |NWS_959 SGO|")
print("[i] LOCAL_INTRANET: ON")
print("[i] TYPE_LINK: INTRANET (HTTPS/SSL)")
print("=" * 59)
print(' ')
print("=" * 59)
print("          [#] \\|Свойства NWS_959 GO сервера:|/")
print("_" * 59)
print(f"[/] IP-АДРЕС СЕРВЕРА: {local_ip}")
print(f"[/] ПОРТ СЕРВЕРА:               {PORT}")
print("[i] СТАТИЧНЫЙ IP-АДРЕС СЕРВЕРА: 127.0.0.1 ")
print(f"[_] ССЫЛКА НА ГЛАВНУЮ СТРАНИЦУ: https://localhost:{PORT}/chat")
print(f"[_] ССЫЛКА НА ДИСК СЕРВЕРА:  https://localhost:{PORT}/storage")
print(f"[_] ССЫЛКА НА ЧАТ СЕРВЕРА:  https://localhost:{PORT}/chat_inter")
print(f"[_] ССЫЛКА НА МЕНЮ СЕРВЕРА:   https://localhost:{PORT}/menu")
print("_" * 59)
print(f"[?] |ПАРАМЕТРЫ СЕРВЕРА В СЕТИ: IP={local_ip}, PORT={PORT}|")
print("=" * 59)
print(' ')

try:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(CERT_FILE, KEY_FILE)
    with ThreadingHTTPServer(("", PORT), IIA_Ultimate_Handler) as httpd:
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n> [!] [Сервер остановлен]")
