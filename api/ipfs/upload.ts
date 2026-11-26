export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const fileName = String(body.fileName || `pukun-banner-${Date.now()}.png`);
    const mimeType = String(body.mimeType || 'image/png');
    const dataBase64 = String(body.dataBase64 || '');

    if (!dataBase64) {
      return res.status(400).json({ error: 'No se recibió imagen para subir a IPFS.' });
    }

    const pinataJwt = (process.env.PINATA_JWT || '').trim().replace(/^["']|["']$/g, '');

    if (!pinataJwt) {
      // Clean graceful fallback so Admin can still preview & publish banners right away,
      // while clearly indicating how to enable permanent decentralized IPFS via Pinata
      const dataUrl = dataBase64.startsWith('data:') ? dataBase64 : `data:${mimeType};base64,${dataBase64}`;
      return res.status(200).json({
        cid: '',
        ipfsUri: '',
        gatewayUrl: dataUrl,
        provider: 'LOCAL_DATA_FALLBACK',
        note: 'Imagen lista. Agrega PINATA_JWT en Vercel para pinearla permanentemente en IPFS descentralizado.',
      });
    }

    const cleanB64 = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;
    const buffer = Buffer.from(cleanB64, 'base64');
    const blob = new Blob([buffer], { type: mimeType });
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append(
      'pinataMetadata',
      JSON.stringify({ name: `PukunTrade_${fileName}` })
    );

    const pinRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pinataJwt}`,
      },
      body: formData,
    });

    const pinJson = (await pinRes.json()) as { IpfsHash?: string; error?: any };
    if (!pinRes.ok || !pinJson?.IpfsHash) {
      return res.status(502).json({
        error: pinJson?.error?.details || pinJson?.error || 'Pinata IPFS rechazó la subida.',
      });
    }

    const cid = pinJson.IpfsHash;
    return res.status(200).json({
      cid,
      ipfsUri: `ipfs://${cid}`,
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
      provider: 'PINATA_IPFS',
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Error subiendo imagen a IPFS',
    });
  }
}

