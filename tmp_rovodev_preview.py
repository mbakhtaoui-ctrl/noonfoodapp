import http.server
import socketserver

PAGE = "sephora-performance-dashboard.html"
PORT = 3000


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.path = "/" + PAGE
        return super().do_GET()

    def end_headers(self):
        # Always serve the freshest build while iterating on the dashboard.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print("Serving %s on port %d" % (PAGE, PORT), flush=True)
    httpd.serve_forever()
