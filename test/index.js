let connParams = {
    host: '192.168.56.56', 
    port: 5672,
    login: 'admin', 
    password: 'admin'
}
let Test = require('../index.js');
let test = new Test(connParams, 'test', '123456');

(async() => {
    test.on('error', (error) => {
        console.log('---------------------------------------')
        console.log(error);
        console.log('---------------------------------------')
    });
    test.on('close', () => {
        console.log('---------------------------------------')
        console.log('close');
        console.log('---------------------------------------')
    });
    await test.init();
    test.registrySubscriber('event1', (data) => {
        console.log('event1:' + JSON.stringify(data));
        // throw new Error('1111')
    });
    test.registrySubscriber('event2', (data) => {
        console.log('event2:' + JSON.stringify(data));
    });
    setInterval(async() => {
        try {
            await test.publish('event1', {a: 1, b: 2});
        }
        catch(error) {
            console.log('111111111111111111111111')
            console.log(error)
        }
    }, 50)

})()