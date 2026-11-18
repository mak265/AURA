const journalEdge = 2048;
const journalBudget = 1024 * 1024;
const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function encode(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to prepare that photo.'));
    }, type, quality);
  });
}

export async function prepareProfilePhoto(canvas) {
  const photo = await encode(canvas, 'image/jpeg', .88);
  return toDataUrl(photo.size <= 180 * 1024 ? photo : await encode(canvas, 'image/jpeg', .82));
}

export async function prepareJournalPhoto(file) {
  const image = await createImageBitmap(file);
  try {
    const edge = Math.max(image.width, image.height);
    if (edge <= journalEdge && file.size <= journalBudget && acceptedTypes.includes(file.type)) {
      return await toDataUrl(file);
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    // WebP preserves transparency when converting PNGs and other source formats.
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    for (const maxEdge of [journalEdge, 1600, 1280, 960]) {
      const scale = Math.min(1, maxEdge / edge);
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [.9, .83]) {
        const blob = await encode(canvas, type, quality);
        if (blob.size <= journalBudget) return await toDataUrl(blob);
      }
    }
    throw new Error('Unable to reduce that photo. Try a different image.');
  } finally {
    image.close();
  }
}
