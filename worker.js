/**
 * Hybrid Proxy Cloudflare Worker (V2)
 * This worker handles the server-side fetching and rewriting.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = url.origin;

    // 1. Get the target URL from the 'id' parameter (Base64)
    let encodedUrl = url.searchParams.get('id');
    if (!encodedUrl) {
      return new Response("Missing 'id' parameter. Usage: /?id=BASE64_URL", { 
        status: 400,
        headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" } 
      });
    }

    try {
      // Decode the target URL
      const targetUrlString = atob(encodedUrl);
      const targetUrl = new URL(targetUrlString);

      // 2. Prepare the request to the real website
      const modifiedRequest = new Request(targetUrl.href, {
        method: request.method,
        headers: this.filterHeaders(request.headers, targetUrl),
        body: request.body,
        redirect: 'follow'
      });

      // 3. Fetch from the real website
      const response = await fetch(modifiedRequest);
      const contentType = response.headers.get('content-type') || '';

      // 4. Handle Content Types
      // If it's HTML: Inject SW registration and rewrite attributes
      if (contentType.includes('text/html')) {
        return this.proxyHtml(response, targetUrl, origin);
      } 
      
      // If it's CSS: Rewrite url() paths
      if (contentType.includes('text/css')) {
        return this.proxyCss(response, targetUrl, origin);
      }

      // Default: Return the resource as-is (Images, JS, etc.)
      const newResponse = new Response(response.body, response);
      this.setCorsHeaders(newResponse.headers);
      return newResponse;

    } catch (e) {
      return new Response(`Proxy Error: ${e.message}`, { status: 500 });
    }
  },

  // Filters headers to prevent "Forbidden Header" errors and set identity
  filterHeaders(headers, targetUrl) {
    const newHeaders = new Headers(headers);
    newHeaders.set('Host', targetUrl.host);
    newHeaders.set('Referer', targetUrl.origin);
    newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    
    // Remove headers that might cause the target site to block the proxy
    newHeaders.delete('cf-connecting-ip');
    newHeaders.delete('x-real-ip');
    newHeaders.delete('x-forwarded-for');
    return newHeaders;
  },

  // Rewrites HTML content to ensure relative paths go through the proxy
  proxyHtml(response, targetUrl, proxyOrigin) {
    const rewriter = new HTMLRewriter()
      // Fix links, images, and sources
      .on('a, img, link, script, form, iframe, source, video', {
        element: (e) => {
          const attributes = ['href', 'src', 'action', 'poster'];
          attributes.forEach(attr => {
            const val = e.getAttribute(attr);
            if (val && !val.startsWith('data:') && !val.startsWith('javascript:') && !val.startsWith('#')) {
              try {
                const absolute = new URL(val, targetUrl.href).href;
                e.setAttribute(attr, `${proxyOrigin}/?id=${btoa(absolute)}`);
              } catch {}
            }
          });
        }
      })
      // Clean up security policies that block proxied scripts
      .on('meta', {
        element: (e) => {
          if (e.getAttribute('http-equiv')?.toLowerCase() === 'content-security-policy') {
            e.remove();
          }
        }
      });

    const modifiedResponse = rewriter.transform(response);
    const results = new Response(modifiedResponse.body, modifiedResponse);
    this.setCorsHeaders(results.headers);
    return results;
  },

  // Rewrites CSS to fix url() paths (background images, fonts)
  async proxyCss(response, targetUrl, proxyOrigin) {
    let text = await response.text();
    const cssUrlRegex = /url\(['"]?([^'")\s]+)['"]?\)/g;
    const modifiedCss = text.replace(cssUrlRegex, (match, p1) => {
      try {
        if (p1.startsWith('data:')) return match;
        const absolute = new URL(p1, targetUrl.href).href;
        return `url('${proxyOrigin}/?id=${btoa(absolute)}')`;
      } catch { return match; }
    });

    const results = new Response(modifiedCss, response);
    this.setCorsHeaders(results.headers);
    return results;
  },

  // Sets standard CORS headers to allow the frontend to access the worker
  setCorsHeaders(headers) {
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', '*');
    // Remove headers that prevent iframe embedding or cross-origin loading
    headers.delete('content-security-policy');
    headers.delete('x-frame-options');
    headers.delete('x-content-type-options');
  }
};
