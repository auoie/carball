"""Send console commands to BakkesMod over its rcon websocket (localhost only), e.g. from WSL.

BakkesMod side (console or cfg/config.cfg): rcon_enabled 1, rcon_password <password>, rcon_port 9002 (default).
After connecting, the client sends "rcon_password <password>" and BakkesMod answers "authyes"; then every text
message is run as a console command.

  python3 tools/physlog/rcon.py [--port 9002] [--password PW] "plugin load physlog" "physlog_run steer"
  (password also from $BAKKES_RCON_PASSWORD)

Standard library only (a minimal websocket client: text frames, masking, no extensions).
"""
import argparse
import base64
import os
import socket
import struct
import sys


def handshake(sock, host, port):
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    response = b""
    while b"\r\n\r\n" not in response:
        chunk = sock.recv(4096)
        if not chunk:
            raise ConnectionError("connection closed during the websocket handshake")
        response += chunk
    if b" 101 " not in response.split(b"\r\n", 1)[0]:
        raise ConnectionError("websocket handshake refused: " + response.split(b"\r\n", 1)[0].decode(errors="replace"))


def send_text(sock, text):
    payload = text.encode()
    header = bytearray([0x81])  # FIN + text
    n = len(payload)
    if n < 126:
        header.append(0x80 | n)
    elif n < 65536:
        header += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        header += bytes([0x80 | 127]) + struct.pack(">Q", n)
    mask = os.urandom(4)
    sock.sendall(bytes(header) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))


def recv_exact(sock, n):
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionError("connection closed")
        data += chunk
    return data


def recv_text(sock):
    """Next text message (control frames: ping answered, close ends)."""
    while True:
        b0, b1 = recv_exact(sock, 2)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", recv_exact(sock, 2))[0]
        elif n == 127:
            n = struct.unpack(">Q", recv_exact(sock, 8))[0]
        mask = recv_exact(sock, 4) if b1 & 0x80 else None
        payload = recv_exact(sock, n)
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        opcode = b0 & 0x0F
        if opcode == 0x1:
            return payload.decode(errors="replace")
        if opcode == 0x8:
            raise ConnectionError("closed by BakkesMod")
        if opcode == 0x9:  # ping -> pong
            sock.sendall(bytes([0x8A, 0x80 | len(payload)]) + b"\0\0\0\0" + payload)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=9002)
    ap.add_argument("--password", default=os.environ.get("BAKKES_RCON_PASSWORD", "password"))
    ap.add_argument("--timeout", type=float, default=3.0)
    ap.add_argument("commands", nargs="+")
    args = ap.parse_args()

    sock = socket.create_connection((args.host, args.port), timeout=args.timeout)
    handshake(sock, args.host, args.port)
    send_text(sock, f"rcon_password {args.password}")
    answer = recv_text(sock)
    if answer.strip() != "authyes":
        sys.exit(f"rcon: not authorised ({answer!r}); check rcon_password")
    for command in args.commands:
        send_text(sock, command)
        print(f"> {command}")
    # Print whatever BakkesMod sends back shortly (console output, if any)
    sock.settimeout(0.5)
    try:
        while True:
            print(recv_text(sock))
    except (socket.timeout, ConnectionError):
        pass
    sock.close()


if __name__ == "__main__":
    main()
