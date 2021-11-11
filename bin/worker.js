#!/usr/bin/env node

const https = require('https');
try {
    var config = require('../config');
} catch (error) {
    console.log('eh, config file not avail. Will use env variables.')
}

let d = new Date();
let n = d.getDay()
console.log("Today's day is: ", n, " - ", d.toISOString());
if (n % 2 === 1)  {
    https.get(config ? config.VIDEO_LINK : process.env.VIDEO_LINK , (resp) => {
        console.log('====================Returning to worker.js====================')
        console.log('Status Code:', resp.statusCode);
        let data = '';
        // A chunk of data has been received.
        resp.on('data', (chunk) => {
            data += chunk;
        });
        // The whole response has been received. Print out the result.
        resp.on('end', () => {
            try {
                data = JSON.parse(data);
                // data is available here:
                console.log(data);
            } catch (e) {
                console.log('Error parsing response JSON!');
            }
        });
        console.log('====================Server Finished====================');
    })
    .on('error', err => {
        console.log('Error: ', err.message);
    });
} else {
    console.log('====================Server Does Not Run====================');
}
