"use client"

import React, { useMemo, useEffect, useState } from "react"

interface MasonryProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  breakpoints: [number, number][] // [width, columns][]
  columnClassName?: string
  getWeight?: (item: T) => number
}

export function Masonry<T>({
  items,
  renderItem,
  breakpoints,
  className = "flex w-auto",
  columnClassName = "bg-clip-padding",
  getWeight = () => 1,
  ...props
}: MasonryProps<T>) {
  const [columnCount, setColumnCount] = useState(() => {
    const sorted = [...breakpoints].sort((a, b) => a[0] - b[0])
    return sorted[0]?.[1] || 1
  })

  useEffect(() => {
    const getColumnCount = () => {
      if (typeof window === "undefined") {
        const sorted = [...breakpoints].sort((a, b) => a[0] - b[0])
        return sorted[0]?.[1] || 1
      }
      const width = window.innerWidth
      const sorted = [...breakpoints].sort((a, b) => b[0] - a[0])

      for (const [breakpoint, cols] of sorted) {
        if (width >= breakpoint) {
          return cols
        }
      }
      // If width is smaller than all breakpoints, use the smallest breakpoint's value
      return sorted[sorted.length - 1]?.[1] || 1
    }

    const handleResize = () => {
      setColumnCount(getColumnCount())
    }

    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [breakpoints])

  const columns = useMemo(() => {
    const cols: { item: T; index: number }[][] = Array.from({ length: columnCount }, () => [])

    if (getWeight) {
      const colWeights = new Array(columnCount).fill(0)

      items.forEach((item, index) => {
        // Find column with minimum weight
        let minWeightIndex = 0
        let minWeight = colWeights[0]

        for (let i = 1; i < columnCount; i++) {
          if (colWeights[i] < minWeight) {
            minWeight = colWeights[i]
            minWeightIndex = i
          }
        }

        cols[minWeightIndex].push({ item, index })
        colWeights[minWeightIndex] += getWeight(item)
      })
    } else {
      // Simple round-robin for performance
      items.forEach((item, index) => {
        cols[index % columnCount].push({ item, index })
      })
    }

    return cols
  }, [items, columnCount, getWeight])

  return (
    <div className={className} {...props}>
      {columns.map((col, colIndex) => (
        <div key={colIndex} className={columnClassName} style={{ flex: 1 }}>
          {col.map(({ item, index }, itemIndex) => (
            <div key={itemIndex}>
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
