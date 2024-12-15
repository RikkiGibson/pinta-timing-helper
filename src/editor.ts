export {};

document.addEventListener('DOMContentLoaded', ready);

function ready() {
    const inputElement = document.getElementById('input-file')!;
    inputElement.addEventListener('change', onFileSelected);
}

let vmuFileBytes: Uint8Array | undefined;
async function onFileSelected(this: HTMLInputElement, ev: Event) {
    vmuFileBytes = new Uint8Array(await this.files![0].arrayBuffer());
    console.log(vmuFileBytes.length);
    const filename = vmuFileBytes.slice(0x200, 0x230);
    const str = String.fromCharCode(...filename);
    console.log(str);
    printItemCounts(vmuFileBytes);

    const count = 3;
    vmuFileBytes[itemCounts.aItems] = count;
    vmuFileBytes[itemLists.aItems] = count;
    vmuFileBytes[itemLists.aItems + 1] = items["Magillex Idol"];
    vmuFileBytes[itemLists.aItems + 2] = items["Magillex Idol"];
    vmuFileBytes[itemLists.aItems + 3] = items["Moonberry"];
    printItemCounts(vmuFileBytes);

    const blob = new Blob([vmuFileBytes.buffer]);
    const link = document.getElementById('save-link') as HTMLAnchorElement;
    link.href = URL.createObjectURL(blob);
}

function printItemCounts(vmuFileBytes: Uint8Array) {
    console.log(`A-item count: ${vmuFileBytes[itemCounts.aItems]}`);
    console.log(`B-item count: ${vmuFileBytes[itemCounts.bItems]}`);
    console.log(`C-item count: ${vmuFileBytes[itemCounts.cItems]}`);
}

// Constants
// ---------

const itemCounts = {
    aItems: 0xa414,
    bItems: 0xa415,
    cItems: 0xa416,
};

// First write the count at the given offset, then write the items in the subsequent offsets
const itemLists = {
    aItems: 0xa482,
    bItems: 0xa502,
    cItems: 0xa582,
};

const items = {
    "Tropica": 0x0,
    "Captain's Hat": 0x1,
    "Mesh Tights": 0x2,
    "Berzerker Mail": 0x3,
    "Light Dress": 0x4,
    "Focus Robe": 0x5,
    "Magillex Idol": 0x6,
    "Pharax Idol": 0x7,
    "Euconyx Idol": 0x8,
    "Moonberry": 0x9,
    "Ivy Band": 0x0A,
    "Silvite Ring": 0x0B,
    "Gem of Fluidity": 0x0C,
    "Wind Gem Ring": 0x0D,
    "Eye of Truth": 0x0E,
    "Revered Voice": 0x0F,
    "Everlasting Gem": 0x10,
    "Behemoth's Ring": 0x11,
    "Constitution Gem": 0x12,
    "Paranta Seed": 0x13,
    "Icyl Seed": 0x14,
    "Zaal Seed": 0x15,
    "Sylph Seed": 0x16,
    "Vidal Seed": 0x17,
    "Magus Seed": 0x18,
    "Warrior's Rune": 0x40,
    "Victory Mail": 0x41,
    "Ghost Mail": 0x42,
    "Sacrulen Box": 0x43,
    "Riselem Box": 0x44,
    "Eternum Box": 0x45,
    "Pyrum Box": 0x46,
    "Crystalen Box": 0x47,
    "Wevlen Box": 0x48,
    "Electrum Box": 0x49,
    "Sacri Box": 0x4A,
    "Sylenis Box": 0x4B,
    "Panika Box": 0x4C,
    "Driln Box": 0x4D,
    "Slipara Box": 0x4E,
    "Pyri Box": 0x4F,
    "Crystales Box": 0x50,
    "Wevles Box": 0x51,
    "Electri Box": 0x52,
    "Sacrum Crystal": 0x80,
    "Sacrulen Crystal": 0x81,
    // "item": 0x82,
    "Risan Crystal": 0x83,
    // "item": 0x84,
    "Glyph of Might": 0x85,
    // "item": 0x86,
    "Healing Salve": 0x87,
    // "item": 0x88,
    // "item": 0x89,
    "Magic Droplet": 0x8A,
    // "item": 0x8B,
    // "item": 0x8C,
    // "item": 0x8D,
    // "item": 0x8E,
    // "item": 0x8F,
    "Rainbow Grule": 0x90,
    // "fish": 0x91,
    // "fish": 0x92,
    // "fish": 0x93,
    // "fish": 0x94,
    // "fish": 0x95,
    // "fish": 0x96,
    // "fish": 0x97,
    // "fish": 0x98,
    // "fish": 0x99,
    "Moonfish": 0x9A,
    "Romuhai Fish": 0x9B,
    // "fish": 0x9C,
    "Red Dragon": 0x9D,
    // "fish": 0x9E,
};