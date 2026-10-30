"""Loopback HTTP/3 WebTransport echo receiver; records only synthetic test data."""
import argparse
import asyncio
import hashlib
import ipaddress
import json
import ssl
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aioquic
from aioquic.asyncio import QuicConnectionProtocol, serve
from aioquic.h3.connection import H3_ALPN, H3Connection
from aioquic.h3.events import DatagramReceived, HeadersReceived, WebTransportStreamDataReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import ConnectionTerminated, HandshakeCompleted, ProtocolNegotiated
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID


def record(kind, **fields):
    print(json.dumps({"kind": kind, **fields}), flush=True)


def certificate(directory):
    certificate_path = directory / "certificate.pem"
    key_path = directory / "key.pem"
    if not certificate_path.exists():
        key = ec.generate_private_key(ec.SECP256R1())
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
        now = datetime.now(timezone.utc)
        value = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(subject)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=2))
            .add_extension(
                x509.SubjectAlternativeName([
                    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                    x509.DNSName("localhost"),
                ]),
                critical=False,
            )
            .sign(key, hashes.SHA256())
        )
        certificate_path.write_bytes(value.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ))
        key_path.chmod(0o600)
    der = ssl.PEM_cert_to_DER_cert(certificate_path.read_text())
    return certificate_path, key_path, hashlib.sha256(der).hexdigest()


class Receiver(QuicConnectionProtocol):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.http = None

    def datagram_received(self, data, address):
        record("udp", bytes=len(data), peer=address[0])
        super().datagram_received(data, address)

    def quic_event_received(self, event):
        if isinstance(event, ProtocolNegotiated):
            self.http = H3Connection(self._quic, enable_webtransport=True)
            record("negotiated", alpn=event.alpn_protocol)
        if isinstance(event, HandshakeCompleted):
            record("handshake", alpn=event.alpn_protocol)
        if isinstance(event, ConnectionTerminated):
            record("terminated", error=event.error_code, reason=event.reason_phrase)
        if not self.http:
            return
        for item in self.http.handle_event(event):
            if isinstance(item, HeadersReceived):
                headers = {key.decode(): value.decode() for key, value in item.headers}
                record("headers", stream=item.stream_id, headers=headers)
                if headers.get(":method") == "CONNECT" and headers.get(":protocol") == "webtransport":
                    self.http.send_headers(item.stream_id, [
                        (b":status", b"200"),
                        (b"sec-webtransport-http3-draft", b"draft02"),
                    ])
                    record("accepted", stream=item.stream_id)
                else:
                    self.http.send_headers(item.stream_id, [(b":status", b"404")], end_stream=True)
            elif isinstance(item, DatagramReceived):
                record("application-datagram", stream=item.stream_id, data=item.data.decode(errors="replace"))
                self.http.send_datagram(item.stream_id, item.data)
            elif isinstance(item, WebTransportStreamDataReceived):
                record("application-stream", stream=item.stream_id, session=item.session_id, data=item.data.decode(errors="replace"))
                self._quic.send_stream_data(item.stream_id, item.data, end_stream=item.stream_ended)
        self.transmit()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--port", type=int, default=0)
    options = parser.parse_args()
    options.directory.mkdir(parents=True, exist_ok=True)
    cert, key, digest = certificate(options.directory)
    config = QuicConfiguration(is_client=False, alpn_protocols=H3_ALPN, max_datagram_frame_size=65536)
    config.load_cert_chain(str(cert), str(key))
    server = await serve("127.0.0.1", options.port, configuration=config, create_protocol=Receiver)
    port = server._transport.get_extra_info("sockname")[1]
    record("ready", port=port, certificateSHA256=digest, aioquic=aioquic.__version__, python=sys.version.split()[0])
    try:
        await asyncio.Future()
    finally:
        server.close()


asyncio.run(main())
