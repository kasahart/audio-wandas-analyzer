"""Receiving requests and handing the figure service its answers (docs/figure-design.md 第 8 節).

protocol_schema.py defines the protocol, command_dispatch.py validates and routes a request, figure_answers.py hands
the figure service its answers. The two entries (backend_server.py for the extension, browser_service.py for the
browser's Pyodide) stay in python-backend/ itself: Python resolves imports from the folder of the script it is
started with, so an entry there finds frames/, services/, figures/ and transport/ with no path set up.
"""
