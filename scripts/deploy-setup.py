#!/usr/bin/env python3
"""
Vercel deployment helper for Personal Context Protocol.

This script helps you complete the deploy setup after creating a Vercel project:
1. Generate a secure PCP_INSTANCE_SECRET
2. Provide instructions for connecting Neon database
3. Show how to set environment variables in Vercel dashboard

Usage: python scripts/deploy-setup.py
"""

import secrets
import subprocess
import sys

def generate_secret():
    """Generate a secure 32-byte hex string for PCP_INSTANCE_SECRET"""
    return secrets.token_hex(32)

def print_setup_instructions():
    """Print complete deployment setup instructions"""
    
    secret = generate_secret()
    
    print("=" * 70)
    print("  PERSONAL CONTEXT PROTOCOL - DEPLOYMENT SETUP GUIDE")
    print("=" * 70)
    print()
    print("Step 1: Create your Vercel project")
    print("-" * 50)
    print("1. Go to https://vercel.com/new")
    print("2. Import your GitHub repo: Nesbitt-bot/personal-context-protocol")
    print("3. Keep default settings (Next.js framework detected)")
    print("4. Click 'Deploy' (don't add env vars yet)")
    print()
    
    print("Step 2: Create Neon database")
    print("-" * 50)
    print("1. Go to https://neon.tech")
    print("2. Sign up / Sign in (free tier available)")
    print("3. Click 'Create a new project'")
    print("4. Name: personal-context-protocol (or any name)")
    print("5. Select region closest to your users")
    print("6. Click 'Create'")
    print("7. Click 'Connection Details' → 'Connection string'")
    print("8. Copy the full connection string (includes password)")
    print()
    
    print("Step 3: Set environment variables in Vercel")
    print("-" * 50)
    print(f"1. Go to your Vercel project settings")
    print("2. Navigate to 'Settings' → 'Environment Variables'")
    print("3. Add these variables:")
    print()
    print(f"   DATABASE_URL: <paste your Neon connection string>")
    print(f"   PCP_INSTANCE_SECRET: {secret}")
    print(f"   PCP_APP_URL: https://<your-app-name>.vercel.app")
    print()
    print("   ⚠️  IMPORTANT: Save the PCP_INSTANCE_SECRET somewhere safe!")
    print("      You cannot retrieve it after this page closes.")
    print()
    print("   Environment variable notes:")
    print("   - DATABASE_URL: From Neon 'Connection string' (includes password)")
    print(f"   - PCP_INSTANCE_SECRET: Generated above (save this!)")
    print(f"   - PCP_APP_URL: Your Vercel domain (will be auto-set on deploy)")
    print("      You can set a placeholder now, or let Vercel auto-set it.")
    print()
    
    print("Step 4: Redeploy")
    print("-" * 50)
    print("1. In Vercel dashboard, click 'Redeploy'")
    print("2. Wait for build to complete")
    print()
    
    print("Step 5: Get the first-login token")
    print("-" * 50)
    print("1. During redeploy, PCP creates the schema and admin credential automatically.")
    print("2. If PCP_ADMIN_TOKEN is not configured, copy the generated admin token from the Vercel build logs.")
    print("3. Visit: https://<your-app-name>.vercel.app/login")
    print("4. Log in, then change the generated token immediately in Settings.")
    print()
    
    print("Step 6: Start using PCP")
    print("-" * 50)
    print("1. Create a topic (e.g., 'work-notes')")
    print("2. Create a session in that topic")
    print("3. Generate an AI token for the session")
    print("4. Give your AI agent: APP_URL, SESSION_ID, SESSION_TOKEN")
    print("5. AI can now append messages to your session!")
    print()
    
    print("=" * 70)
    print("  GENERATED SECURE SECRET (save this!):")
    print(f"  {secret}")
    print("=" * 70)
    print()
    print("Tip: Copy this entire output and save it to your password manager.")
    print()

def check_prerequisites():
    """Check if user has git and is in the right directory"""
    try:
        result = subprocess.run(['git', 'rev-parse', '--show-toplevel'], 
                              capture_output=True, text=True, check=True)
        repo_root = result.stdout.strip()
        print(f"✓ Detected repository: {repo_root}")
    except subprocess.CalledProcessError:
        print("✗ Not in a Git repository. Please run this from your project root.")
        sys.exit(1)

def main():
    check_prerequisites()
    print()
    print("🚀  Starting deployment setup for Personal Context Protocol...")
    print()
    print_setup_instructions()

if __name__ == '__main__':
    main()
