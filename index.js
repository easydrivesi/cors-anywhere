const express = require("express");
const request = require("request");
const path = require("path");
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require('cors');
const nocache = require('nocache');
const app = express();
const port = process.env.PORT || "8000";
app.use(cors())
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(nocache());
var originBlacklist = parseEnvList(process.env.CORSANYWHERE_BLACKLIST);
var originWhitelist = parseEnvList(process.env.CORSANYWHERE_WHITELIST);
function parseEnvList(env) {
    if (!env) {
        return [];
    }
    return env.split(',');
}

// Set up rate-limiting to avoid abuse of the public CORS Anywhere server.
var checkRateLimit = require('./lib/rate-limit')(process.env.CORSANYWHERE_RATELIMIT);

var cors_proxy = require('./lib/cors-anywhere');
var proxy = cors_proxy.createServer({
    originBlacklist: originBlacklist,
    originWhitelist: originWhitelist,
    requireHeader: [],
    checkRateLimit: checkRateLimit,
    removeHeaders: [
        'cookie',
        'cookie2',
        // Strip Heroku-specific headers
        'x-request-start',
        'x-request-id',
        'via',
        'connect-time',
        'total-route-time',
        // Other Heroku added debug headers
        // 'x-forwarded-for',
        // 'x-forwarded-proto',
        // 'x-forwarded-port',
    ],
    redirectSameOrigin: true,
    httpProxyOptions: {
        // Do not add X-Forwarded-For, etc. headers, because Heroku already adds it.
        xfwd: false,
    },
});
app.all('/*', cors({
    methods: ['GET', 'HEAD', 'PUT', 'POST', 'PATCH', 'DELETE'],
    origin: '*',
}), async (req, res) => {
    if (!`${req.headers['content-type']}`.includes('multipart')) {
        var url = `${req.url}`;
        url = req.url.replace(/https:\/[^\/]/gi, function (x) {
            return x.replace('https:/', 'https://');
        });
        var x_proxy_domain = req.headers['x-proxy-domain'];
        if (x_proxy_domain != null) {
            url = '/' + x_proxy_domain;
        }
        while (url.length > 0 && url[0] == '/') {
            url = url.substring(1, url.length);
        }
        var headers = Object(req.headers);
        delete headers['host'];
        delete headers['connection'];
        delete headers['cache-control'];
        delete headers['user-agent'];
        delete headers['sec-fetch-mode'];
        delete headers['sec-fetch-site'];
        delete headers['sec-ch-ua'];
        delete headers['sec-ch-ua-mobile'];
        delete headers['sec-ch-ua-platform'];
        delete headers['upgrade-insecure-requests'];
        delete headers['accept'];
        delete headers['sec-fetch-user'];
        delete headers['sec-fetch-dest'];
        delete headers['accept-encoding'];
        delete headers['accept-language'];
        delete headers['x-proxy-domain'];
        if (url.length > 0) {
            try {
                if (!url.startsWith('http') && !url.includes('http')) {
                    url = 'https://' + url;
                }
                new URL(url);
                var options = {
                    url: url,
                    method: req.method,
                    headers: req.headers,
                    form: req.body,
                };
                var response = await promisifiedRequest(options);
                try {
                    var body = JSON.parse(response.body);
                    return res.json(body);
                } catch (e) {
                }
            } catch (e) {
            }
        }
    }
    proxy.emit('request', req, res);
});
app.listen(port, () => {
    console.log(`Listening to requests on http://localhost:${port}`);
});

async function promisifiedRequest(options) {
    return new Promise((resolve, reject) => {
        request(options, (error, response, body) => {
            if (response) {
                return resolve(response);
            }
            if (error) {
                return reject(error);
            }
        });
    });
};