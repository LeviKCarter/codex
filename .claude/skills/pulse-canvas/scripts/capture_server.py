"""Receives the captures the page posts during /pulse-canvas. Local only: binds 127.0.0.1 and answers localhost:3000.

    python capture_server.py <out-dir>
"""
import http.server
import os
import re
import sys

OUT = os.path.abspath(sys.argv[1])
os.makedirs(OUT, exist_ok=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', 'http://localhost:3000')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        # The page fetches the capture functions from here, so nothing has to be pasted into it.
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'capture.js'), 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.cors()
        self.send_header('Content-Type', 'text/javascript; charset=utf-8')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        name = re.sub(r'[^A-Za-z0-9_.-]', '', self.path.split('name=')[-1])
        body = self.rfile.read(int(self.headers['Content-Length']))
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(body)
        self.send_response(200)
        self.cors()
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', 4174), Handler).serve_forever()
