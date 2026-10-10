const { objects1, objects2, objects3, objects4 } = require('./sources');
const { EventEmitter } = require('node:events');

const updater = new EventEmitter();

function updateDevices(objects) {
    const count = Math.floor(Math.random() * 501) + 100; // 100–600

    const indexes = new Set();

    while (indexes.size < count && indexes.size < objects.length) {
        indexes.add(Math.floor(Math.random() * objects.length));
    }

    const changedDevices = [];

    for (const index of indexes) {
        const object = objects[index];

        if (object.type === 'boolean') {
            object.value = Math.random() < 0.5;
        } else if (object.type === 'float' || object.type === 'double') {
            const value = Math.floor(Math.random() * 10000) / 100;
            object.value = Number.isInteger(value) ? value + 0.01 : value;
        } else {
            object.value = Math.floor(Math.random() * 101);
        }

        changedDevices.push(object);
    }

    return changedDevices;
}

setInterval(() => {
    updater.emit('update', {
        objects1: updateDevices(objects1),
        objects2: updateDevices(objects2),
        objects3: updateDevices(objects3),
        objects4: updateDevices(objects4)
    });
}, 1000);

module.exports = {
    objects1,
    objects2,
    objects3,
    objects4,
    updater,
};