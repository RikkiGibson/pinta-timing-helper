export {};

document.addEventListener('DOMContentLoaded', ready);

function ready() {
    const inputElement = document.getElementById('input-file')!;
    inputElement.addEventListener('change', onFileSelected);
}

async function onFileSelected(this: HTMLInputElement, ev: Event) {
    const bytes = new Uint8Array(await this.files![0].arrayBuffer());
    console.log(bytes.length);
    const filename = bytes.slice(0x200, 0x230);
    const str = String.fromCharCode(...filename);
    console.log(str);
    // TODO: stick a button on the page to save the modified file
}

