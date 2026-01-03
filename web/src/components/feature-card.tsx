import type React from "react"

export function FeatureCard({
  icon,
  title,
  description,
  delay,
}: {
  icon: React.ReactNode
  title: string
  description: string
  delay: string
}) {
  return (
    <div
      className="group bg-card border border-border rounded-2xl p-8 space-y-4 hover:shadow-xl hover:border-primary/50 transition-all duration-300 hover:-translate-y-1 animate-fade-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="text-primary group-hover:scale-110 transition-transform duration-300 inline-block mb-0">{icon}</div>
      <h3 className="text-xl font-bold text-card-foreground">{title}</h3>
      <p className="text-muted-foreground leading-relaxed">{description}</p>
    </div>
  )
}
