#!/usr/bin/env python3
"""
Sphinx configuration for Personal Context Protocol documentation.
"""
import os
import sys

sys.path.insert(0, os.path.abspath('..'))

project = 'Personal Context Protocol'
copyright = '2026, Nesbitt-bot'
author = 'Nesbitt-bot'

# Use Read the Docs theme
extensions = [
    'myst_parser',  # For Markdown support
    'sphinx.ext.autodoc',
    'sphinx.ext.napoleon',
    'sphinx.ext.viewcode',
    'sphinx.ext.githubpages',
]

# Theme configuration
html_theme = 'sphinx_rtd_theme'
html_theme_options = {
    'navigation_depth': 4,
    'display_version': True,
    'collapse_navigation': False,
}

# Markdown support
myst_enable_extensions = [
    "dollarmath",
    "amsmath",
    "deflist",
    "colon_fence",
]

# File patterns to include
templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']

# Output settings
html_static_path = ['_static']
html_extra_path = ['../README.md']  # Include root README

# Custom CSS
def setup(app):
    app.add_css_file('custom.css')
