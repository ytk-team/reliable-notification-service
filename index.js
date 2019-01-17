const amqp = require('amqplib');
const fs = require('fs');
const EventEmitter = require('events').EventEmitter;
module.exports = class extends EventEmitter {
    constructor(connParam, scope = "qtk-reliable-notification", clientId) {
        super();
        this._connection = undefined;
        this._subscriber = new Map();
        this._exchangeName = `e_${scope}`;
        this._queueName = `q_${scope}_${clientId}`;
        this._clientId = clientId;
        this._connParam = connParam;
    }

    async init() {
        this._connection = await this._createConnection(this._connParam);
        await this._connection.assertExchange(this._exchangeName, 'direct', {
            durable: true, //交换器持久化
        });
        await this._connection.assertQueue(this._queueName, {
            durable: true, //队列持久化
            autoDelete: false //避免完全没有客户端时队列被删除
        });
        await this._connection.bindQueue(this._queueName, this._exchangeName);
        this._connection.consume(this._queueName, async (data) => {
            let {event, message} = JSON.parse(data.content.toString());
            try {
                if (this._subscriber.has(event)) {
                    await this._subscriber.get(event)(message);
                }
                this._connection.ack(data);
            }
            catch(error) {
                this.emit('error', error);
            }

        }, {noAck: false});
    }

    async publish(event, message) {
        await this._connection.publish(
            this._exchangeName, 
            this._namespace, 
            Buffer.from(JSON.stringify({event, message})), 
            {
                deliveryMode: 2 //数据持久化
            }
        );
    }

    registrySubscriber(event, handler) {
        this._subscriber.set(event, handler);
    }

    async _createConnection(connParam) {
        let opts = {
            protocol: 'amqp',
            hostname: connParam.host,
            port: connParam.port,
            username: connParam.login,
            password: connParam.password,
            heartbeat: connParam.heartbeat || 10,
            vhost: connParam.vhost || '/',
            reconnect: connParam.reconnect || 2,
        };
        if (connParam.ssl) {
            if (connParam.ssl.pfx) {
                Object.assign(opts, {
                    pfx: fs.readFileSync(connParam.ssl.pfx),
                    passphrase: connParam.ssl.passphrase
                })
            }
            else {
                Object.assign(opts, {
                    cert: fs.readFileSync(connParam.ssl.cert),
                    key: fs.readFileSync(connParam.ssl.key),
                })
            }
        }

        let connection = await amqp.connect(opts);
        let channel = undefined;
        connection.on('error', async (e) => {
            if (e.message == 'Heartbeat timeout') {
                while (1) {
                    try {
                        await new Promise((resolve) => setTimeout(() => resolve(), opts.reconnect * 1000));
                        this.emit('reconnect');
                        await this.init();
                        break;
                    }
                    catch(error) {
                        this.emit('error', error);
                    }
                }
            }
            else {
                this.emit('error', e);
            }
        });
       
        connection.on('close', () => {
            this.emit('close');
        });
    
        channel = await connection.createConfirmChannel();
    
        channel.on('error', (e) => {
            this.emit('error', e);
        });
       
        channel.on('close', () => {
            this.emit('close');
        });
    
        return channel;
    }
}