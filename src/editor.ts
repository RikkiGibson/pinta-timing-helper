export {};

document.addEventListener('DOMContentLoaded', ready);

function ready() {
    const inputElement = document.getElementById('input-file')!;
    inputElement.addEventListener('change', onFileSelected);
}

async function onFileSelected(this: HTMLInputElement, ev: Event) {
    const buffer = await this.files![0].arrayBuffer();
    console.log(buffer.byteLength);
}

