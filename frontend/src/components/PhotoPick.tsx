import { isMobile } from '../lib/scan'

const ACCEPT = 'image/jpeg,image/png,image/webp' // iPhones send HEIC photos as JPEG for this list

/** Two ways to give Scythe a photo: take one now with the phone's camera, or choose a saved one (photos, screenshots,
 *  files). The camera one only shows on a phone or tablet. */
export default function PhotoPick({ onPhoto, take = true }: { onPhoto: (photo: File) => void; take?: boolean }) {
  const input = (camera: boolean) => (
    <input type="file" accept={ACCEPT} capture={camera ? 'environment' : undefined} style={{ display: 'none' }}
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPhoto(f) }} />
  )
  return (
    <span className="row">
      {take && isMobile() && <label className="link">take a photo{input(true)}</label>}
      <label className="link">choose a photo{input(false)}</label>
    </span>
  )
}
