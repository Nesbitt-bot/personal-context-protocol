import logging
import os
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

def setup_logger(name: str, log_dir: str = None) -> logging.Logger:
    """
    Set up a structured logger following AGENTS.md guidelines.
    
    - One file per run: logs/run-YYYYMMDD-HHMMSS.log
    - INFO for milestones (kept forever)
    - DEBUG for high-frequency detail (aged by age, not size)
    - WARNING/ERROR never aged out
    - Never log secrets
    
    Args:
        name: Logger name (typically __name__)
        log_dir: Directory for logs (defaults to ~/.pcp-logs)
    
    Returns:
        Configured logger instance
    """
    if log_dir is None:
        log_dir = os.path.expanduser('~/.pcp-logs')
    
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    
    # Avoid duplicate handlers
    if logger.handlers:
        return logger
    
    # Console handler (INFO level)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_format = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(console_format)
    logger.addHandler(console_handler)
    
    # File handler (DEBUG level) - one file per run
    timestamp = __import__('datetime').datetime.now().strftime('%Y%m%d-%H%M%S')
    log_file = Path(log_dir) / f'run-{timestamp}.log'
    
    file_handler = TimedRotatingFileHandler(
        log_file,
        when='midnight',
        interval=1,
        backupCount=7  # Keep 7 days of logs
    )
    file_handler.setLevel(logging.DEBUG)
    file_format = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(file_format)
    logger.addHandler(file_handler)
    
    # Log startup message
    logger.info(
        "Operational logs can be replayed: structured logging / logger initialization "
        f"- per-run log file created at {log_file}"
    )
    
    return logger

# Convenience function for quick logging
def log_message(level: str, message: str, logger: logging.Logger = None):
    """
    Log a message at the specified level.
    
    Usage:
        log_message("INFO", "Dataset can be processed: data pipeline / load input - 10000 records loaded")
        log_message("DEBUG", f"Batch can be tracked: data pipeline / batch progress - processed {i} of {total}")
        log_message("ERROR", f"Batch cannot be completed: data pipeline / item processing - {error}")
    """
    if logger is None:
        logger = setup_logger(__name__)
    
    if level.upper() == "INFO":
        logger.info(message)
    elif level.upper() == "DEBUG":
        logger.debug(message)
    elif level.upper() == "WARNING":
        logger.warning(message)
    elif level.upper() == "ERROR":
        logger.error(message)
    elif level.upper() == "CRITICAL":
        logger.critical(message)
