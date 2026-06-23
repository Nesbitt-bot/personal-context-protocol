# Sphinx configuration for Personal Context Protocol documentation

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.abspath('..'))

project = 'Personal Context Protocol'
copyright = '2026, Nesbitt-bot'
author = 'Nesbitt-bot'
release = '0.1.1'

# Extensions
extensions = [
    'myst_parser',
    'sphinx.ext.autodoc',
    'sphinx.ext.napoleon',
    'sphinx.ext.viewcode',
    'sphinx.ext.githubpages',
]

# Theme
html_theme = 'sphinx_rtd_theme'
html_theme_options = {
    'navigation_depth': 4,
    'collapse_navigation': False,
}

# MYST configuration for Markdown
myst_enable_extensions = [
    "dollarmath",
    "amsmath",
    "deflist",
    "colon_fence",
]

# Suppress specific warnings
suppress_warnings = [
    'misc.highlighting_failure',  # SQL $1, $2 placeholders
    'toc.not_included',  # Files included via toctree glob
]

# File patterns
templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']

# Static files
html_static_path = ['_static']

# Custom CSS
def setup(app):
    app.add_css_file('custom.css')
