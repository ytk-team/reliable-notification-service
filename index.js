const amqp = require('amqplib');
const fs = require('fs');
const EventEmitter = require('events').EventEmitter;
module.exports = class extends EventEmitter {
    constructor(connParam, scope = "qtk-reliable-notification", clientId) {
        super();
        this._connection = undefined;
        this._scope = scope;
        this._exchangeName = `e_${this._scope}`;
        this._clientId = clientId;
        this._connParam = connParam;
        this.subscriberes = [];
    }

    async init(isReconnect = false) {
        this._connection = await this._createConnection(this._connParam);
        await this._connection.assertExchange(this._exchangeName, 'topic', {
            durable: true, //交换器持久化
        });

        if (isReconnect) {
            this.subscriberes.forEach(subscriber => this.queueBind(
                subscriber.event,
                subscriber.handler,
                subscriber.queueSuffix
            ));
        }
    }

    async publish(event, message) {
        await this._connection.publish(
            this._exchangeName,
            event,
            Buffer.from(JSON.stringify(message)),
            {
                deliveryMode: 2 //数据持久化
            }
        );
    }

    async registrySubscriber(event, handler, queueSuffix = undefined) {
        this.subscriberes.push({ event, handler, queueSuffix });
        await this.queueBind(event, handler, queueSuffix);
    }

    async queueBind(event, handler, queueSuffix) {
        let queueName = `q_${this._scope}_${this._clientId}_${event}`;
        if (queueSuffix !== undefined) {
            queueName += `_${queueSuffix}`;
        }
        await this._connection.assertQueue(queueName, {
            durable: true, //队列持久化
            autoDelete: false //避免完全没有客户端时队列被删除
        });
        await this._connection.bindQueue(queueName, this._exchangeName, event);
        this._connection.consume(queueName, async (data) => {
            let message = JSON.parse(data.content.toString());
            try {
                await handler(message);
                this._connection.ack(data);
            }
            catch (error) {
                this.emit('error', error);
            }
        }, { noAck: false });
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
                        await this.init(true);
                        break;
                    }
                    catch (error) {
                        this.emit('error', error);
                    }
                }
            }
            else {
                this.emit('error', e);
            }
        });

        connection.on('close', async () => {
            this.emit('close');
        });

        channel = await connection.createConfirmChannel();

        channel.on('error', (e) => {
            this.emit('error', e);
        });

        channel.on('close', async () => {
            this.emit('close');
            while (1) {
                try {
                    connection.close().catch(error => console.log(error));
                    await new Promise((resolve) => setTimeout(() => resolve(), opts.reconnect * 1000));
                    this.emit('reconnect');
                    await this.init(true);
                    break;
                }
                catch (error) {
                    this.emit('error', error);
                }
            }
        });

        return channel;
    }
}
