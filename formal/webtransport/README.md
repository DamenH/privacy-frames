# Native WebTransport receiver control

Run from the repository root after building the manager, runtime and examples:

```sh
node formal/webtransport/run.ts
```

The runner uses `uv` to provision Python 3.13 and the exact packages in
`requirements.lock`. To use an existing environment containing those packages:

```sh
PF_WEBTRANSPORT_PYTHON=/path/to/python node formal/webtransport/run.ts
```

No browser flags, certificate-store installation or elevated privileges are
required. The receiver binds only loopback UDP on a random port. It generates a
temporary ECDSA P-256 certificate valid for two days; the browser authenticates
its SHA-256 DER fingerprint using `serverCertificateHashes`. Private test keys
and certificates are deleted when the runner finishes.

For each browser, the unrestricted control must establish HTTP/3 WebTransport,
receive the receiver's datagram echo, and receive a bidirectional stream echo.
If that control fails, the run fails without claiming that the endpoint works.
The control browser then exits. The receiver restarts on the same port with the
same certificate, and a fresh browser installs the existing adversary example
into the production runtime. The exact same connection function, URL, pin and
synthetic payload are attempted there. Any UDP packet reaching the receiver
fails the confined measurement, even if no session or application data follows.
A 1.5-second observation interval follows the attempt; observation continues
through browser shutdown.

`results.json` records browser versions, runtime build provenance, input hashes,
positive-control HTTP/3 events and confined receiver events. The test covers the
specified loopback WebTransport endpoint and the current production Window
profile. It does not establish arbitrary-destination packet coverage, worker
coverage, certificate interoperability across other engines, or a proof that
all browser-mediated transports are confined.

The receiver uses [aioquic's HTTP/3/WebTransport implementation](https://github.com/aiortc/aioquic)
and follows its [HTTP/3 server example](https://github.com/aiortc/aioquic/blob/main/examples/http3_server.py).
The certificate pin interface is defined in the [WebTransport specification](https://www.w3.org/TR/webtransport/#dom-webtransportoptions-servercertificatehashes).
