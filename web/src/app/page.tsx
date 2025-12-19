"use client"

import type React from "react"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Search, FolderOpen, Heart, Globe, Zap, Shield, ArrowRight, Sparkles } from "lucide-react"

export default function LandingPage() {
  const [scrollY, setScrollY] = useState(0)

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute inset-0 bg-linear-to-br from-primary/5 via-background to-accent-500/5"
          style={{ transform: `translateY(${scrollY * 0.5}px)` }}
        />
        {/* Floating orbs */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent-500/10 rounded-full blur-3xl animate-float-delay" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl border-b border-border/50 bg-background/80">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-10 h-10 bg-linear-to-br from-primary to-accent-500 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl text-foreground">MemeDB</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/search" className="text-sm font-medium hover:text-primary transition-colors">
              Search
            </Link>
            <Link href="/explore" className="text-sm font-medium hover:text-primary transition-colors">
              Explore
            </Link>
            <Link href="/login">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/register">
              <Button className="gap-2">
                Get Started <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </nav>
          <div className="md:hidden flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm">Start</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 md:py-32 relative">
        <div className="max-w-5xl mx-auto text-center space-y-8 animate-fade-in">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-2 text-sm font-medium text-primary">
            <Sparkles className="w-4 h-4" />
            <span>Organize 10,000+ memes with AI-powered search</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold text-balance leading-tight">
            Your Personal
            <br />
            <span className="bg-linear-to-r from-primary via-accent-500 to-primary bg-clip-text text-transparent animate-gradient">
              Meme Universe
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground text-balance max-w-3xl mx-auto leading-relaxed">
            Smart organization, lightning-fast search, and seamless sharing.
            <br className="hidden md:block" />
            Everything you need to manage your meme collection.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6">
            <Link href="/register" className="w-full sm:w-auto">
              <Button size="lg" className="text-lg px-10 py-6 w-full sm:w-auto group">
                Start Free
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/search" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="text-lg px-10 py-6 w-full sm:w-auto bg-transparent">
                <Search className="w-5 h-5 mr-2" />
                Try Search
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-8 pt-12 max-w-2xl mx-auto">
            <div className="space-y-1">
              <div className="text-3xl md:text-4xl font-bold text-primary">10K+</div>
              <div className="text-sm text-muted-foreground">Memes Organized</div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl md:text-4xl font-bold text-accent-500">5K+</div>
              <div className="text-sm text-muted-foreground">Active Users</div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl md:text-4xl font-bold text-primary">99.9%</div>
              <div className="text-sm text-muted-foreground">Uptime</div>
            </div>
          </div>
        </div>

        {/* Animated Preview */}
        <div className="mt-20 max-w-6xl mx-auto perspective-1000">
          <div
            className="bg-card/50 backdrop-blur-sm rounded-2xl border border-border shadow-2xl overflow-hidden transform hover:scale-[1.01] transition-transform duration-500"
            style={{ transform: `rotateX(${scrollY * 0.02}deg)` }}
          >
            <img
              src="/modern-meme-search-interface-with-masonry-grid-lay.jpg"
              alt="MemeDB Interface"
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20 md:py-32 relative">
        <div className="text-center mb-16 md:mb-20 animate-fade-in">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">Built for Speed & Simplicity</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Everything you need to organize, find, and share your favorite memes
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          <FeatureCard
            icon={<Search className="w-8 h-8" />}
            title="Smart Search"
            description="AI-powered search finds memes by content, tags, or context instantly."
            delay="0"
          />
          <FeatureCard
            icon={<FolderOpen className="w-8 h-8" />}
            title="Cloud Storage"
            description="Organize with nested folders, breadcrumb navigation, and drag-and-drop."
            delay="100"
          />
          <FeatureCard
            icon={<Heart className="w-8 h-8" />}
            title="Quick Favorites"
            description="Save memes and folders with one tap for instant access later."
            delay="200"
          />
          <FeatureCard
            icon={<Globe className="w-8 h-8" />}
            title="Social Discovery"
            description="Explore trending collections and share your best memes publicly."
            delay="300"
          />
          <FeatureCard
            icon={<Zap className="w-8 h-8" />}
            title="Instant Upload"
            description="Drag files anywhere or tap upload. Processing happens in the background."
            delay="400"
          />
          <FeatureCard
            icon={<Shield className="w-8 h-8" />}
            title="Privacy First"
            description="Full control over public/private settings for every meme and folder."
            delay="500"
          />
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 md:py-32">
        <div className="relative bg-linear-to-br from-primary via-primary to-accent-500 text-primary-foreground rounded-3xl p-12 md:p-20 text-center overflow-hidden">
          <div className="absolute inset-0 bg-grid-white/10" />
          <div className="relative z-10 space-y-6 max-w-3xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-bold text-balance">Ready to organize your memes?</h2>
            <p className="text-xl opacity-90 text-balance">
              Join thousands of users who trust MemeDB to keep their collections organized
            </p>
            <Link href="/register">
              <Button size="lg" variant="secondary" className="text-lg px-10 py-6 mt-4 group">
                Get Started Free
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-linear-to-br from-primary to-accent-500 rounded-lg flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground">MemeDB</span>
            </div>
            <p className="text-sm text-muted-foreground">&copy; 2025 MemeDB. All rights reserved.</p>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="/search" className="hover:text-foreground transition-colors">
                Search
              </Link>
              <Link href="/explore" className="hover:text-foreground transition-colors">
                Explore
              </Link>
              <Link href="/login" className="hover:text-foreground transition-colors">
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({
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
