
const fs = require('node:fs');
const path = require('node:path');
const { objects1, objects2, objects3, objects4, updater, } = require('./updater');
const { TrendStore } = require('./trend-store');

const invalidDevices = new Map();
const logPath = path.join(__dirname, 'invalid_devices.json');
const trendStore = new TrendStore(path.join(__dirname, 'trends.db'));
const trendByObject = new Map();
const sourceGroups = [
    { name: 'source_1', objects: objects1 },
    { name: 'source_2', objects: objects2 },
    { name: 'source_3', objects: objects3 },
    { name: 'source_4', objects: objects4 }
];
let lastWrittenLogData;
let logWriteQueue = Promise.resolve();

for (const source of sourceGroups) {
    for (const object of source.objects.slice(0, 5)) {
        trendByObject.set(object, {
            trendId: `${source.name}:${object.id}`,
            source: source.name,
            objectId: object.id,
            objectName: object.name
        });
    }
}

if (trendByObject.size !== 20) {
    throw new Error(`Expected 20 trend objects, found ${trendByObject.size}`);
}

for (const trend of trendByObject.values()) {
    trendStore.registerTrend(trend);
}

function main(changedObjects) {
    const validObjects = [
        ...printValidationCounts(changedObjects.objects1, 'Source 1'),
        ...printValidationCounts(changedObjects.objects2, 'Source 2'),
        ...printValidationCounts(changedObjects.objects3, 'Source 3'),
        ...printValidationCounts(changedObjects.objects4, 'Source 4')
    ];

    try {
        trendStore.upsertValidBatch(validObjects);
    } catch (error) {
        console.error('Failed to store valid values:', error);
    }

    const logData = serializeInvalidDevices();

    if (logData !== lastWrittenLogData) {
        logWriteQueue = logWriteQueue.then(async () => {
            const latestLogData = serializeInvalidDevices();
            if (latestLogData === lastWrittenLogData) {
                return;
            }

            await fs.promises.writeFile(logPath, latestLogData, 'utf8');
            lastWrittenLogData = latestLogData;
        }).catch(error => {
            console.error('Failed to write invalid_devices.json:', error);
        });
    }
}

function serializeInvalidDevices() {
    const entries = [...invalidDevices.values()].map(entry => `  ${JSON.stringify(entry)}`);
    return entries.length > 0
        ? `[\n${entries.join(',\n')}\n]\n`
        : '[]\n';
}

updater.on('update', main);

// ------------------------------------------------------------------------------------------------

class device_validator {
    static validateDevice(object) {
        return this.getValidationError(object) === null;
    }

    static getValidationError(object) {
        if (!Number.isInteger(object.id)) {
            return 'id must be an integer';
        }
        if (typeof object.type !== 'string') {
            return 'type must be a string';
        }
        if (typeof object.name !== 'string') {
            return 'name must be a string';
        }

        const typeError = this.validateType(object.type, object.value);
        if (typeError !== null) {
            return typeError;
        }

        if (!object.condition) {
            return null;
        }

        return this.validateCondition(
            object.value,
            object.condition
        );
    }


    static validateType(type, value) {
        switch (type) {
            case 'byte':
                return Number.isInteger(value) && value >= 0 && value <= 255
                    ? null
                    : `value must be an integer between 0 and 255 for type byte (received ${value})`;

            case 'short':
                return Number.isInteger(value) && value >= -32768 && value <= 32767
                    ? null
                    : `value must be an integer between -32768 and 32767 for type short (received ${value})`;

            case 'int':
                return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
                    ? null
                    : `value must be a 32-bit integer for type int (received ${value})`;

            case 'long':
                return Number.isSafeInteger(value)
                    ? null
                    : `value must be a safe integer for type long (received ${value})`;

            case 'float':
                return typeof value === 'number' &&
                    Number.isFinite(value) &&
                    !Number.isInteger(value) &&
                    Math.abs(value) <= 3.4028235e38
                    ? null
                    : `value must be a finite, non-integer 32-bit floating-point number (received ${value})`;

            case 'double':
                return typeof value === 'number' &&
                    Number.isFinite(value) &&
                    !Number.isInteger(value)
                    ? null
                    : `value must be a finite, non-integer number for type double (received ${value})`;

            case 'boolean':
                return typeof value === 'boolean'
                    ? null
                    : `value must be a boolean for type boolean (received ${value})`;

            default:
                return `unsupported type "${type}"`;
        }
    }

    static validateCondition(value, condition) {
        switch (condition.operator) {
            case '==':
                return value === condition.value
                    ? null
                    : `value ${value} does not equal condition value ${condition.value}`;

            case '<=':
                return value <= condition.value
                    ? null
                    : `value ${value} is greater than condition limit ${condition.value}`;

            case 'between':
                return value >= condition.min && value <= condition.max
                    ? null
                    : `value ${value} is outside condition range [${condition.min}, ${condition.max}]`;

            default:
                return `unsupported condition operator "${condition.operator}"`;
        }
    }
}

function printValidationCounts(objects, sourceName) {
    let validCount = 0;
    let invalidCount = 0;
    const validObjects = [];

    for (const object of objects) {
        const reason = device_validator.getValidationError(object);

        if (reason === null) {
            validCount++;
            validObjects.push(object);
            invalidDevices.delete(object);

            const trend = trendByObject.get(object);
            if (trend) {
                try {
                    trendStore.appendIfChanged(trend, object.value);
                } catch (error) {
                    console.error(
                        `Failed to store value for trend ${trend.trendId}:`,
                        error
                    );
                }
            }
        } else {
            invalidCount++;
            invalidDevices.set(object, { id: object.id ?? null, reason });
        }
    }

    console.log(`${sourceName}: valid=${validCount}, invalid=${invalidCount}`);
    return validObjects;
}

main({ objects1, objects2, objects3, objects4 });
