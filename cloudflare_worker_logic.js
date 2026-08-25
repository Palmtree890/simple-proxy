// ... inside your filterHeaders function ...
filterHeaders(headers, targetUrl) {
  const newHeaders = new Headers(headers);
  newHeaders.set('Host', targetUrl.host);
  // Some sites check the 'Origin' header to block proxies
  if (newHeaders.has('Origin')) {
    newHeaders.set('Origin', targetUrl.origin);
  }
  // ... rest of the code ...
}

// ... inside your setCorsHeaders function ...
setCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Credentials', 'true'); // Added for sites with logins
  headers.delete('content-security-policy');
  headers.delete('x-frame-options');
  headers.delete('frame-options'); // Some sites use the older version
}