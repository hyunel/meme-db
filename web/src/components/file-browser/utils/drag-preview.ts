import type { BrowseItem } from "./types"

/**
 * Creates a custom drag preview element with thumbnails and a count badge.
 */
export function createDragPreview(items: BrowseItem[]): HTMLElement {
  const count = items.length
  const preview = document.createElement("div")

  // Container styling
  preview.style.position = "absolute"
  preview.style.top = "-1000px"
  preview.style.left = "-1000px"
  preview.style.pointerEvents = "none"
  preview.style.zIndex = "9999"

  // Stack container
  const stack = document.createElement("div")
  stack.style.position = "relative"
  stack.style.width = "64px"
  stack.style.height = "64px"

  // Show up to 3 thumbnails in a stack
  const previewItems = items.slice(0, 3)
  previewItems.forEach((item, index) => {
    const imgContainer = document.createElement("div")
    imgContainer.style.position = "absolute"
    imgContainer.style.top = `${index * 4}px`
    imgContainer.style.left = `${index * 4}px`
    imgContainer.style.width = "56px"
    imgContainer.style.height = "56px"
    imgContainer.style.borderRadius = "8px"
    imgContainer.style.border = "2px solid white"
    imgContainer.style.overflow = "hidden"
    imgContainer.style.backgroundColor = "hsl(var(--muted))"
    imgContainer.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.2)"
    imgContainer.style.zIndex = `${3 - index}`

    if (item.type === "meme" && item.meme?.url) {
      const img = document.createElement("img")
      img.src = item.meme.url
      img.style.width = "100%"
      img.style.height = "100%"
      img.style.objectFit = "cover"
      imgContainer.appendChild(img)
    } else {
      // Folder icon placeholder
      const folderIcon = document.createElement("div")
      folderIcon.style.width = "100%"
      folderIcon.style.height = "100%"
      folderIcon.style.display = "flex"
      folderIcon.style.alignItems = "center"
      folderIcon.style.justifyContent = "center"
      folderIcon.style.backgroundColor = "hsl(var(--primary))"
      folderIcon.style.color = "white"
      folderIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`
      imgContainer.appendChild(folderIcon)
    }

    stack.appendChild(imgContainer)
  })

  preview.appendChild(stack)

  // Count badge
  if (count > 1) {
    const badge = document.createElement("div")
    badge.style.position = "absolute"
    badge.style.top = "-8px"
    badge.style.right = "-8px"
    badge.style.backgroundColor = "hsl(var(--primary))"
    badge.style.color = "hsl(var(--primary-foreground))"
    badge.style.borderRadius = "12px"
    badge.style.padding = "2px 8px"
    badge.style.fontSize = "12px"
    badge.style.fontWeight = "bold"
    badge.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)"
    badge.style.zIndex = "10"
    badge.innerText = count.toString()
    stack.appendChild(badge)
  }

  return preview
}
