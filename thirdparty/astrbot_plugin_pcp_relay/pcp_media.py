"""Bounded image collection from platform image segments, never message text."""
from __future__ import annotations
import base64
import ipaddress
import socket
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

MAX_BYTES = 6 * 1024 * 1024
LOCAL_ROOT = Path('/AstrBot/data/temp')
CDN_SUFFIXES = ('qpic.cn', 'qq.com', 'qlogo.cn', 'discordapp.com', 'discordapp.net')


def public_cdn_url(url):
    p = urlsplit(url)
    if p.scheme != 'https' or p.username or p.password or p.port not in (None, 443):
        return False
    host = (p.hostname or '').lower()
    if not any(host == suffix or host.endswith('.' + suffix) for suffix in CDN_SUFFIXES):
        return False
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return bool(addresses) and all(ipaddress.ip_address(a[4][0]).is_global for a in addresses)


class CheckedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not public_cdn_url(newurl):
            raise ValueError('Image unavailable: AstrBot/media redirect - target is not a public platform CDN')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def read_image(source):
    if source.startswith('base64://'):
        if len(source) > 8 * 1024 * 1024 + 9:
            raise ValueError('Image unavailable: AstrBot/media size - encoded image exceeds six MiB')
        return base64.b64decode(source[9:], validate=True)
    if source.startswith('https://') or source.startswith('http://'):
        # QQ sometimes supplies http links; request the same CDN resource over TLS.
        source = 'https://' + source.split('://', 1)[1]
        if not public_cdn_url(source):
            raise ValueError('Image unavailable: AstrBot/media URL - source is not a public platform CDN')
        opener = urllib.request.build_opener(CheckedRedirect)
        with opener.open(source, timeout=15) as response:
            return response.read(MAX_BYTES + 1)
    file = Path(source.removeprefix('file://')).resolve()
    if not file.is_relative_to(LOCAL_ROOT.resolve()):
        raise ValueError('Image unavailable: AstrBot/media path - file is outside the adapter temporary directory')
    with file.open('rb') as stream:
        return stream.read(MAX_BYTES + 1)


def collect_images(segments):
    media, warnings, total = [], [], 0
    for segment in segments:
        kind = type(segment).__name__.lower()
        if kind != 'image':
            continue
        if len(media) >= 4:
            warnings.append('[image omitted: four-image limit]')
            continue
        source = getattr(segment, 'url', '') or getattr(segment, 'file', '')
        try:
            data = read_image(str(source))
            if not data or total + len(data) > MAX_BYTES:
                raise ValueError('Image unavailable: AstrBot/media size - turn exceeds six MiB')
            media.append({'name': f'image-{len(media) + 1}', 'data': base64.b64encode(data).decode('ascii')})
            total += len(data)
        except (OSError, ValueError):
            warnings.append('[image omitted: unavailable or exceeds media limits]')
    return media, warnings
