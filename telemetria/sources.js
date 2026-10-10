const fs = require('node:fs');
const path = require('node:path');

class device {
    constructor(id, type, name, value, condition) {
        this.id = id;
        this.type = type;
        this.name = name;
        this.value = value;
        this.condition = condition;
    }
}

class device1 {
    constructor(id, type, name, value, condition) {
        this.id = id;
        this.type = type;
        this.name = name;
        this.value = value;
        this.condition = condition;
    }
}

class device2 {
    constructor(id, type, name, value, condition) {
        this.id = id;
        this.type = type;
        this.name = name;
        this.value = value;
        this.condition = condition;
    }
}

class device3 {
    constructor(id, type, name, value, condition) {
        this.id = id;
        this.type = type;
        this.name = name;
        this.value = value;
        this.condition = condition;
    }
}

function loadJSON(filename) {
    const filePath = path.join(__dirname, 'json', filename);
    const data = fs.readFileSync(filePath, 'utf8');
    const objects = JSON.parse(data);

    if (!Array.isArray(objects)) {
        throw new TypeError(`${filename} must contain a JSON array`);
    }

    return objects;
}

function createDevices(source, DeviceClass) {
    return source.map(item => {
        const data = item && typeof item === 'object' ? item : {};
        return new DeviceClass(
            data.id,
            data.type,
            data.name,
            data.value,
            data.condition
        );
    });
}

const objects1 = createDevices(loadJSON('source_1.json'), device);
const objects2 = createDevices(loadJSON('source_2.json'), device1);
const objects3 = createDevices(loadJSON('source_3.json'), device2);
const objects4 = createDevices(loadJSON('source_4.json'), device3);

module.exports = {
    device,
    device1,
    device2,
    device3,
    loadJSON,
    objects1,
    objects2,
    objects3,
    objects4
};

