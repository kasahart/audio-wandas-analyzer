"""Check that what the backend thins to draw never becomes a number the app shows (display rules R1, R2, R6, R7).

The backend thins data in a few functions (SOURCES: min/max per bucket, block peaks, resampled cells) and by one
bucket rule (block edges, ``_time_blocks``). What they give is a picture: it may be drawn, indexed, rounded and sent
in a picture's drawn fields (DRAWN_KEYS), and nothing else. This script follows every value they give through the
backend's own code (python-backend, not its tests) and fails where one becomes a number:

- a reduction of drawn points (``np.median``, ``np.max``, ``np.percentile``, ``np.argmax``, ``np.interp``,
  ``sorted``, ``.max()``, …): a median, extreme, range, order, readout or headline of what is drawn;
- a difference of two drawn values (``a - b``, ``np.subtract``): a Δ of drawn points;
- a field of an answer that is not a drawn one (``"minDb"``, ``"peak"``, ``"value"``, …) given drawn points;
- a decision made of drawn points (a comparison) sent, counted or used to pick what is reduced.

Values carry what they are:

- ``D`` drawn: what a decimator gave. Any reduction or Δ of it is a flow.
- ``P`` positions: bucket edges or blocks (the bucket rule). Not values; a value taken at them is a bucket.
- ``B`` bucket: the values of one bucket (``times[block]``). Reducing a bucket is how a picture is thinned (``T``).
- ``T`` thinned: values made of buckets (a block average). Thinning them further along an axis (a band's power
  mean, an interpolated narrow band) still makes the picture; reducing them to one number is a flow.
- ``C`` decided: a comparison of drawn points (``drawn > level``, ``bool(...)``). A mask drawn as the picture's own
  field is drawing; sent in any other field, counted or summed (``np.sum(mask)``, ``any(...)``), or used to pick
  values that are then reduced, it is a number decided by drawn points: a flow.

The analysis follows values through assignments, tuples, containers (a dict's fields one by one), calls into the
backend's own functions (with what each argument carries), ``dataclasses.replace``, attributes set on ``self`` and
module-level stores. A comparison is not a value: it is a decision (``C``), followed as one. A name bound to a
function (``reduce = np.max``, ``from numpy import max as top``, a module-level ``REDUCE = np.median``, a lambda) is
that function where it is called, and a function handed to another (``map(np.max, rows)``, ``key=``) is called on
the other arguments. Where the analysis cannot finish, it fails naming the file:line it stopped at, never passes
(Unfinished): a call of a value it cannot resolve to a function (a parameter, ``getattr``, ``partial``) given drawn
points, a statement it does not follow, a loop or a recursion that does not settle, a chain of calls too deep.

Flows the backend has today are in KNOWN_FLOWS, each with its gap in the contract table (src/test/plotContracts):
the list only shrinks. A flow not listed fails, and so does a listed one no longer found.

Which fields are drawn points is read from the protocol's schema (python-backend/protocol_schema.py: the arrays
marked ``x-drawn``), not listed here, and decided where each field is written: by module, function and field. The
dict a function returns is the answer its return annotation names (``-> StagePoints``: a definition of the schema,
whose ``values`` are ``x-whole``; ``-> StageValueRange``: a TypedDict whose ``min`` is a ``float``), and so is a
local annotated with such a type; their own fields are what that answer says they are. Every other dict (one
nested in an answer, one sent through a callback, a store or ``json.dumps``, any dict of a function whose return
annotation is a scalar or says nothing), and a field that answer has not, is taken by its field's name. A number
written out (``2048``, a module-level ``EVENT_POINTS = 2048``) is never an array of drawn points.

And the other way round: every value put in an array of drawn points must have come from a registered thinning
function (SOURCES), or its place is listed in drawn_points_contract.json ('unthinned') with why it sends every
value. So a new function that thins data and sends it (whatever way it thins: a stepped slice, a reshape and a
min/max, a resample) fails here until it is registered, and once registered its result is followed.

What this cannot see, stated plainly: thinning added inside a function already listed under 'unthinned' (the list is
the review point: keep each entry to one field of one function); a wrong return annotation (pyright checks it
against the code); a value that mixes a registered function's result with data thinned some other way (it counts
as registered); and thinned data sent in a field the schema does not mark ``x-drawn`` at all (test_protocol_schema.py
makes every array of numbers say x-drawn, x-whole or x-place, but a wrong mark is a reviewer's to catch).

The backend readers classified 'draws' in python-backend/drawn_points_contract.json are checked too: what each
returns of drawn points carries its name wherever it goes, and the reader fails if its own code, or any code its
result reaches, makes a flow of it (another field, a reduction, a decision): drawing is only putting it in a picture.

Run: ``python scripts/check_decimation_flow.py`` (exit 1 on a problem); ``--list`` prints every flow found.
"""

from __future__ import annotations

import argparse
import ast
import builtins
import hashlib
import importlib.util
import json
import re
import sys
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "python-backend"
CONTRACT = ROOT / "python-backend" / "drawn_points_contract.json"

WHOLE = "*"
#: The source of a 'draws' reader's result in a flow (``draws=module:function``).
TAG = "draws="
DRAWN, POSITIONS, BUCKET, THINNED, DECIDED = "D", "P", "B", "T", "C"
#: A function as a value (``reduce = np.max``, a lambda, a def handed on): its origin is ``fn=<what>|F``, ``<what>``
#: one of ``np.max``, ``builtins.max``, ``module:function`` (the backend's) or ``closure:<where>`` (a lambda or a local
#: def, kept in Program.closures). Called, it is that function called.
FUNCTION = "F"
FN = "fn="

#: The backend's functions that thin data to draw it: what kind their result is and which of its fields are thinned
#: (WHOLE: all of it). Every one but the bucket rule's (BUCKET_RULE) is a decimator of drawn_points_contract.json too.
SOURCES: dict[str, tuple[str, frozenset[str]]] = {
    "decimator:decimated_waveform": (DRAWN, frozenset({"min", "max", "minT", "maxT", "samples"})),
    # Per bucket the index of its lowest and of its highest sample: which samples are drawn.
    "decimator:bucket_extremes": (DRAWN, frozenset({WHOLE})),
    "decimator:bucket_starts": (POSITIONS, frozenset({WHOLE})),
    "decimator:bucket_edges": (POSITIONS, frozenset({WHOLE})),
    **{
        f"stage_view:{name}": (DRAWN, frozenset({WHOLE}))
        for name in (
            "min_max_indices",
            "min_max_line",
            "min_max_rows",
            "spectrum_line",
            "_block_peaks",
            "_signed_peaks",
            "_envelope_indices",
            "_envelope",
            "_cepstrum_envelope",
        )
    },
    "stage_view:_time_blocks": (POSITIONS, frozenset({WHOLE})),
    "stage_view:samples_waveform": (DRAWN, frozenset({"min", "max", "minT", "maxT"})),
    **{
        f"analyzer:{name}": (DRAWN, frozenset({WHOLE}))
        for name in ("resample_frequency_bins", "_resample_time_bins", "min_max_spectrum")
    },
    # A scan's 192-point spectrum: every Welch bin power-averaged into log-spaced points, to draw.
    "scan_service:log_spectrum": (DRAWN, frozenset({WHOLE})),
}
#: The bucket rule's own functions (decimator.py): positions only, which the contract table does not list.
BUCKET_RULE = frozenset({"decimator:bucket_starts", "decimator:bucket_edges"})


def protocol_definitions() -> dict[str, object]:
    """The protocol's definitions (python-backend/protocol_schema.py), read as the backend itself declares them."""
    spec = importlib.util.spec_from_file_location("awa_protocol_schema", BACKEND / "protocol_schema.py")
    if spec is None or spec.loader is None:
        raise SystemExit("check_decimation_flow: python-backend/protocol_schema.py cannot be read")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return dict(module.DEFINITIONS)


def _marked(node: object, mark: str) -> bool:
    """Whether ``node`` (a schema, or part of one) says ``mark`` anywhere inside it."""
    if isinstance(node, dict):
        return mark in node or any(_marked(value, mark) for value in node.values())
    return isinstance(node, list) and any(_marked(value, mark) for value in node)


def schema_fields(schema: object, mark: str) -> tuple[frozenset[str], frozenset[str]]:
    """The names of the protocol's fields marked ``mark`` (``x-drawn``, ``x-whole``, ``x-place``): first the arrays
    whose numbers carry the mark, then the fields that are objects holding such an array (a picture's ``waveform``)."""
    arrays: set[str] = set()
    holders: set[str] = set()

    def walk(node: object) -> None:
        if isinstance(node, dict):
            properties = node.get("properties")
            for name, child in properties.items() if isinstance(properties, dict) else ():
                if isinstance(child, dict) and child.get("type") == "array" and _marked(child.get("items"), mark):
                    arrays.add(name)
                elif _marked(child, mark):
                    holders.add(name)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema)
    return frozenset(arrays), frozenset(holders - arrays)


#: The protocol's arrays of points thinned to be drawn (``x-drawn``), and the fields that hold such arrays: read from
#: the schema, never listed here. Marking a new array ``x-drawn`` in protocol_schema.py is all it takes to put it
#: under this check.
DEFINITIONS = protocol_definitions()
DRAWN_ARRAYS, DRAWN_HOLDERS = schema_fields(DEFINITIONS, "x-drawn")
#: Where a picture's drawn points sit on its axes. The schema marks these ``x-place`` (a place is not a value a user
#: reads as a level), so they are named here; main() fails if one is not an ``x-place`` array of the schema.
DRAWN_PLACES = frozenset({"xs", "ys", "frequenciesHz", "timeCentersSec"})
#: The fields of a picture that carry its drawn points: a drawn value may go here, and only here.
DRAWN_KEYS = DRAWN_ARRAYS | DRAWN_HOLDERS | DRAWN_PLACES

#: Reductions: a number made of the values given (a median, an extreme, a range, an order, a sum, a readout).
REDUCERS = frozenset(
    {
        *("median", "nanmedian", "mean", "nanmean", "average", "max", "min", "amax", "amin", "nanmax", "nanmin"),
        *("argmax", "argmin", "nanargmax", "nanargmin", "percentile", "nanpercentile", "quantile", "nanquantile"),
        *("ptp", "std", "nanstd", "var", "nanvar", "sum", "nansum", "sort", "argsort", "lexsort", "partition"),
        *("argpartition", "dot", "cumsum", "interp", "bincount", "histogram"),
    }
)
#: Reductions whose second positional argument is the axis.
AXIS_SECOND = REDUCERS - {
    *("percentile", "nanpercentile", "quantile", "nanquantile", "dot", "interp", "lexsort", "bincount", "histogram")
}
#: Reductions along an axis by nature (a value per x, not one number).
ALONG_AXIS = frozenset({"interp"})
BUILTIN_REDUCERS = frozenset({"max", "min", "sorted", "sum"})
#: NumPy calls that arrange, convert, round or test values without computing a number of them: drawn points given
#: to these are still drawn (the picture's own form), not a reader's computation.
ARRANGING = frozenset(
    {
        *("asarray", "array", "stack", "vstack", "hstack", "concatenate", "round", "nan_to_num", "take_along_axis"),
        *("reshape", "isfinite", "isnan", "copy", "full_like", "zeros_like", "ascontiguousarray", "where", "unique"),
    }
)
#: Attributes of an array that are not its values.
SHAPE_ATTRIBUTES = frozenset({"size", "shape", "ndim", "dtype", "nbytes", "itemsize"})
#: Methods that put their argument into their receiver (a list, a cache, a store), by how their names start.
STORING_METHODS = ("append", "extend", "insert", "add", "put", "set", "store", "cache", "remember", "__setitem__")
#: Return annotations of a scalar: the function returns no answer of the protocol. This says nothing of the dicts it
#: makes inside (it may still send a picture through a callback or a store): those are taken by their fields' names.
SCALAR_TYPES = frozenset({"int", "float", "bool", "str", "bytes", "None"})
#: How far the analysis goes before it stops (and fails, naming where): calls inside calls, rounds of a loop's body,
#: of a recursion and of the stores, until what they carry settles.
CALL_DEPTH = 40
LOOP_ROUNDS = 12
RECURSION_ROUNDS = 8
STORE_ROUNDS = 10
#: Statements that carry no value: nothing to follow.
INERT_STATEMENTS = (ast.Pass, ast.Break, ast.Continue, ast.Global, ast.Nonlocal, ast.Import, ast.ImportFrom)
#: Python's builtin functions, by name: a value of one is that function.
BUILTIN_NAMES = frozenset(name for name in dir(builtins) if callable(getattr(builtins, name)))
#: Calls whose result carries nothing of their arguments' values.
CLEAN_BUILTINS = frozenset({"len", "isinstance", "callable", "type", "id", "hash", "range", "str", "repr", "getattr"})

#: Flows the backend has today, by ``module:function: what``, with the contract table's gap that holds each (or, for
#: a number the app does not show, why). Fix the flow and remove its line; never add one to let a new flow through.
KNOWN_FLOWS: dict[str, str] = {}

Pair = tuple[str, str]  # (field, origin): origin is "source|kind"; a parameter's source is "@index:kind"
Taint = frozenset[Pair]
CLEAN: Taint = frozenset()


def kind_of(origin: str) -> str:
    return origin[-1]


def source_of(origin: str) -> str:
    return origin[:-2]


def with_kind(origin: str, kind: str) -> str:
    return f"{origin[:-1]}{kind}"


def flat(taint: Taint) -> Taint:
    """``taint`` as one value: every origin, as the whole. A function in it is not part of a value computed of it
    (``np.asarray(x, dtype=np.float64)`` is no function): only a function itself, or a container of one, is one."""
    return frozenset((WHOLE, origin) for _, origin in taint if kind_of(origin) != FUNCTION)


def rekind(taint: Taint, change: Callable[[str], str]) -> Taint:
    return frozenset((name, with_kind(origin, change(kind_of(origin)))) for name, origin in taint)


#: How deep a container's fields are told apart (``channels.values``); deeper, the field stands for all inside it.
DEPTH = 4


def nest(key: str, name: str) -> str:
    """The field ``name`` of a value put under ``key``."""
    path = key if name == WHOLE else f"{key}.{name}"
    return ".".join(path.split(".")[:DEPTH])


def nested(taint: Taint, key: object) -> Taint:
    """``taint`` put under the field ``key`` of a container (a dict's key, a tuple's ``#index``)."""
    if not isinstance(key, str):
        return flat(taint)
    return frozenset((nest(key, name), origin) for name, origin in taint)


def element(taint: Taint, key: object) -> Taint:
    """What ``value[key]`` (or ``value.key``) carries: a field by name, a tuple's item by position, else the value."""
    if isinstance(key, int):
        key = f"#{key}"
    out: set[Pair] = set()
    for name, origin in taint:
        head, _, rest = name.partition(".")
        if name == WHOLE:
            out.add((WHOLE, origin))
        elif isinstance(key, str):
            if head == key:
                out.add((rest or WHOLE, origin))
            elif not key.startswith("#") and head.startswith("#"):
                continue
            elif key.startswith("#") and not head.startswith("#"):
                out.add((name, origin))  # an item of a list keeps its fields
        elif head.startswith("#"):
            out.add((rest or WHOLE, origin))
        else:
            out.add((name, origin))
    return frozenset(out)


def bare(taint: Taint) -> Taint:
    """The pairs that are the value itself (or a tuple's item), not a field of a container in it."""
    return frozenset(pair for pair in taint if pair[0] == WHOLE or re.fullmatch(r"#\d+", pair[0]))


def decided(taint: Taint) -> Taint:
    """A comparison (or a truth) of ``taint``: a decision made of its drawn points, as one value."""
    return frozenset((WHOLE, with_kind(origin, DECIDED)) for _, origin in taint if kind_of(origin) in (DRAWN, DECIDED))


def decisions_of(taint: Taint) -> Taint:
    """The pairs that are decisions made of drawn points."""
    return frozenset(pair for pair in taint if kind_of(pair[1]) == DECIDED)


def values_of(taint: Taint) -> Taint:
    """The pairs that are values (drawn or thinned), not positions or buckets."""
    return frozenset(pair for pair in taint if kind_of(pair[1]) in (DRAWN, THINNED))


@dataclass(frozen=True)
class Flow:
    """A drawn value made a number: where (``module:function``), what, and the decimators it came from."""

    where: str
    line: int
    what: str
    origins: frozenset[str]
    path: tuple[str, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.where}: {self.what}"

    @property
    def sources(self) -> list[str]:
        return sorted({source_of(origin) for origin in self.origins if not source_of(origin).startswith(TAG)})

    @property
    def tags(self) -> list[str]:
        """The 'draws' readers (``module:function``) whose result this flow is made of."""
        return sorted({source_of(origin)[len(TAG) :] for origin in self.origins if source_of(origin).startswith(TAG)})


class Unfinished(Exception):
    """The analysis could not follow the code to its end: each line names the file:line it stopped at, why, and how
    to write it so it can (UNFINISHED_FIX). A check that cannot finish fails; it never passes what it did not see."""

    def __init__(self, stops: list[str]) -> None:
        super().__init__("\n".join(stops))
        self.stops = stops


UNFINISHED_FIX = (
    "Fix: write it so the analysis follows it: call a function by its name, or by a name bound to one "
    "(``reduce = np.max``), not through a value it cannot resolve (a parameter, getattr, partial); no class or "
    "statement it does not follow inside a function (move a class to the module); a loop or a recursion whose "
    "values settle. If what it then follows makes a number of drawn points, take that number from the full data."
)


@dataclass
class Function:
    name: str  # module:Qual.name
    module: str
    node: ast.FunctionDef | ast.AsyncFunctionDef
    cls: str | None
    params: list[str]


@dataclass
class Module:
    name: str
    tree: ast.Module
    aliases: dict[str, str] = field(default_factory=dict)  # local name -> module
    imported: dict[str, str] = field(default_factory=dict)  # local name -> module:function
    globals: set[str] = field(default_factory=set)
    #: Names bound at the module's top to a function (``REDUCE = np.max``, ``from numpy import max as top``).
    callables: dict[str, ast.expr] = field(default_factory=dict)
    #: Names this module gives NumPy (``import numpy as xp``), beside ``np`` and ``numpy``.
    numpy: set[str] = field(default_factory=lambda: {"np", "numpy"})


def _short(node: ast.AST) -> str:
    text = ast.unparse(node)
    return text if len(text) <= 80 else text[:77] + "..."


Context = tuple[frozenset[tuple[str, str]], ...]  # per parameter: (field, kind) it carries


@dataclass(frozen=True)
class Summary:
    """What a function does given its parameters' context: what it returns, the flows in it, and what it puts in
    stores of what its parameters carry (for the caller to put its own origins in)."""

    returned: Taint
    flows: list[Flow]
    stores: list[tuple[str, Taint]]


EMPTY = Summary(frozenset(), [], [])


@dataclass
class Closure:
    """A lambda or a local def as a value: where it was made, and what the names it can see held there (only what
    came from outside the function that made it: its parameters' values are that function's caller's to say)."""

    node: ast.Lambda | ast.FunctionDef | ast.AsyncFunctionDef
    function: Function
    env: dict[str, Taint]
    local_defs: dict[str, ast.FunctionDef | ast.AsyncFunctionDef]


class Program:
    """The backend's modules, functions and what flows between them."""

    def __init__(self, sources: dict[str, str], tagged: Iterable[str] = ()) -> None:
        #: The 'draws' readers (``module:function``): what each returns of drawn points also carries its name.
        self.tagged = frozenset(tagged)
        self.modules = {name: Module(name, ast.parse(text)) for name, text in sorted(sources.items())}
        self.functions: dict[str, Function] = {}
        #: The backend's classes (dataclasses, NamedTuples, TypedDicts) by ``module:Class``: their fields in order.
        self.classes: dict[str, list[str]] = {}
        #: Each class's fields' annotations (``min: float``), by ``module:Class``.
        self.annotations: dict[str, dict[str, ast.expr]] = {}
        #: Module-level names bound to a number written out, by ``module:NAME``.
        self.numbers: set[str] = set()
        #: The protocol's definitions (protocol_schema.py), by name: what an answer annotated with one is.
        self.definitions: dict[str, dict[str, object]] = {
            name: value for name, value in DEFINITIONS.items() if isinstance(value, dict)
        }
        #: Where the analysis stopped, by place: why (see Unfinished).
        self.stops: dict[str, str] = {}
        #: A recursion's summary so far, by (function, context), while it is followed again until it settles.
        self.assumed: dict[tuple[str, Context], Summary] = {}
        self.recursed: set[tuple[str, Context]] = set()
        #: Where each store was last added to (``python-backend/module.py:line function``), to name one not settling.
        self.store_sites: dict[str, str] = {}
        self.changed_stores: set[str] = set()
        #: The lambdas and local defs made into values, by ``closure:<where>`` (see FUNCTION); and those being called.
        self.closures: dict[str, Closure] = {}
        self.calling: set[str] = set()
        for module in self.modules.values():
            self._index(module)
        self.memo: dict[tuple[str, Context], Summary] = {}
        self.active: set[tuple[str, Context]] = set()
        #: Values kept on an object or a module-level store, by ``module:Class.attr`` / ``module:NAME``.
        self.stores: dict[str, Taint] = {}
        self.stores_changed = False
        #: The functions whose own code computes with drawn, thinned or decided points (arithmetic, a comparison, a
        #: reduction, a numeric call), by ``module:function``: with the decimators those points came from.
        self.readers: dict[str, set[str]] = {}
        #: Where a value that no thinning function gave is put in an ``x-drawn`` array of the protocol, by
        #: ``module:function#field``, with the first line it happens on (see unthinned_problems).
        self.unthinned: dict[str, int] = {}

    def _index(self, module: Module) -> None:
        for node in ast.walk(module.tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name in self.modules:
                        module.aliases[alias.asname or alias.name] = alias.name
                    elif alias.name == "numpy":
                        module.numpy.add(alias.asname or alias.name)
            elif isinstance(node, ast.ImportFrom) and node.module in self.modules and node.level == 0:
                for alias in node.names:
                    module.imported[alias.asname or alias.name] = f"{node.module}:{alias.name}"
            elif isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] == "numpy":
                # ``from numpy import max as top``: ``top`` is ``np.max`` wherever it is called.
                for alias in node.names:
                    path: ast.expr = ast.Name("np", ast.Load())
                    for part in [*(node.module or "").split(".")[1:], alias.name]:
                        path = ast.Attribute(path, part, ast.Load())
                    module.callables[alias.asname or alias.name] = path
        for node in module.tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self._add(module.name, node, None)
            elif isinstance(node, ast.ClassDef):
                fields = [
                    item for item in node.body if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name)
                ]
                self.classes[f"{module.name}:{node.name}"] = [item.target.id for item in fields]  # type: ignore[attr-defined]
                self.annotations[f"{module.name}:{node.name}"] = {
                    item.target.id: item.annotation  # type: ignore[attr-defined]
                    for item in fields
                }
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        self._add(module.name, item, node.name)
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                module.globals.update(target.id for target in targets if isinstance(target, ast.Name))
        # A module-level name bound to a number written out (``EVENT_POINTS = 2048``): a number, never an array.
        for node in module.tree.body:
            if isinstance(node, ast.Assign) and _number_literal(node.value):
                self.numbers.update(f"{module.name}:{t.id}" for t in node.targets if isinstance(t, ast.Name))
            elif (
                isinstance(node, ast.AnnAssign)
                and isinstance(node.target, ast.Name)
                and node.value is not None
                and _number_literal(node.value)
            ):
                self.numbers.add(f"{module.name}:{node.target.id}")
        # A module-level name bound to a function (``REDUCE = np.max``) is that function, not a store.
        for node in module.tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                bound = self.callable_at(module, node.value)
                if bound is not None:
                    module.callables[node.targets[0].id] = bound
                    module.globals.discard(node.targets[0].id)

    def is_numpy(self, module: str, node: ast.expr) -> bool:
        """Whether ``node`` is NumPy or an attribute of it (``np.linalg``), by the names ``module`` gives NumPy."""
        while isinstance(node, ast.Attribute):
            node = node.value
        return isinstance(node, ast.Name) and node.id in self.modules[module].numpy

    def named_function(self, module: str, cls: str | None, node: ast.expr, depth: int = 0) -> str | None:
        """The function ``node`` names in ``module`` with no local in the way, as an origin (FUNCTION), if it names
        one: a NumPy function, a backend function or class, a module-level name bound to one, a builtin."""
        mod = self.modules[module]
        if isinstance(node, ast.Attribute) and self.is_numpy(module, node):
            parts: list[str] = []
            inner: ast.expr = node
            while isinstance(inner, ast.Attribute):
                parts.insert(0, inner.attr)
                inner = inner.value
            return f"{FN}np.{'.'.join(parts)}|{FUNCTION}"
        if isinstance(node, ast.Name) and node.id in mod.callables and depth < 8:
            return self.named_function(module, cls, mod.callables[node.id], depth + 1)
        if not isinstance(node, (ast.Name, ast.Attribute)):
            return None
        target = self.resolve(module, cls, node)
        if target is not None and (target in self.functions or target in SOURCES or target in self.classes):
            return f"{FN}{target}|{FUNCTION}"
        if isinstance(node, ast.Name) and node.id in BUILTIN_NAMES and node.id not in mod.globals:
            return f"{FN}builtins.{node.id}|{FUNCTION}"
        return None

    def callable_at(self, module: Module, node: ast.expr) -> ast.expr | None:
        """The function ``node`` names at a module's top, if it names one: a NumPy function, a builtin reducer, a
        backend function, or another such name."""
        if isinstance(node, ast.Attribute) and self.is_numpy(module.name, node):
            return node
        if isinstance(node, ast.Name):
            if node.id in module.callables:
                return module.callables[node.id]
            if node.id in BUILTIN_REDUCERS and node.id not in module.globals:
                return node
        if isinstance(node, (ast.Name, ast.Attribute)) and self.resolve(module.name, None, node) is not None:
            return node
        return None

    def stop(self, module: str, line: int, function: str, why: str) -> None:
        """The analysis stopped at ``module``:``line`` in ``function`` (see Unfinished)."""
        where = f"python-backend/{module}.py:{line} {function.split(':', 1)[-1]}"
        self.stops.setdefault(where, why)

    def answer(self, function: Function) -> tuple[str, str] | None:
        """What answer ``function`` returns, by its return annotation (see ``typed``)."""
        return self.typed(function.module, function.node.returns)

    def typed(self, module: str, node: ast.expr | None) -> tuple[str, str] | None:
        """What an annotation (``X | None`` is ``X``) says a value is: ``("schema", name)`` for a definition of the
        protocol, ``("record", module:Class)`` for another class of the backend, ``("none", "")`` for a scalar;
        None when it does not say."""
        while isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            node = node.right if isinstance(node.left, ast.Constant) and node.left.value is None else node.left
        if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == "Optional":
            node = node.slice
        if isinstance(node, ast.Constant) and node.value is None:
            return ("none", "")
        if not isinstance(node, ast.Name):
            return None
        if node.id in SCALAR_TYPES:
            return ("none", "")
        if node.id in self.definitions:
            return ("schema", node.id)
        mine = f"{module}:{node.id}"
        record = mine if mine in self.annotations else self.modules[module].imported.get(node.id)
        return ("record", record) if record in self.annotations else None

    def _add(self, module: str, node: ast.FunctionDef | ast.AsyncFunctionDef, cls: str | None) -> None:
        qual = f"{cls}.{node.name}" if cls else node.name
        args = node.args
        params = [a.arg for a in [*args.posonlyargs, *args.args, *args.kwonlyargs]]
        self.functions[f"{module}:{qual}"] = Function(f"{module}:{qual}", module, node, cls, params)

    def resolve(self, module: str, cls: str | None, func: ast.expr) -> str | None:
        """The backend function a call names, if it is one."""
        mod = self.modules[module]
        if isinstance(func, ast.Name):
            here = f"{module}:{func.id}"
            if here in self.functions or here in SOURCES or here in self.classes:
                return here
            return mod.imported.get(func.id)
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            if func.value.id in mod.aliases:
                return f"{mod.aliases[func.value.id]}:{func.attr}"
            if func.value.id in ("self", "cls") and cls and f"{module}:{cls}.{func.attr}" in self.functions:
                return f"{module}:{cls}.{func.attr}"
        return None

    def analyse(self, name: str, context: Context) -> Summary:
        """What ``name`` returns and the flows inside it when its parameters carry ``context`` (as origins
        ``@index:kind``, for the caller to put its own in)."""
        key = (name, context)
        if key in self.memo:
            return self.memo[key]
        if key in self.active:
            # A recursion: what the call gives so far, followed again below until that settles.
            self.recursed.add(key)
            return self.assumed.get(key, EMPTY)
        self.active.add(key)
        function = self.functions[name]
        try:
            for _ in range(RECURSION_ROUNDS):
                before = set(self.memo)
                walker = Walker(self, function)
                for index, (param, carried) in enumerate(zip(function.params, context, strict=False)):
                    # A function given is itself (its origin), not the caller's to say: it is called as it is.
                    walker.env[param] = frozenset(
                        (f, k if kind_of(k) == FUNCTION and len(k) > 1 else f"@{index}:{k}|{k}") for f, k in carried
                    )
                walker.block(function.node.body)
                result = Summary(walker.returned, walker.flows, walker.pending)
                assumed = self.assumed.get(key, EMPTY)
                if key not in self.recursed or (result.returned, result.stores) == (assumed.returned, assumed.stores):
                    break
                # What the recursive call was taken to give was short of what it gives: again, with this.
                self.assumed[key] = result
                for stale in set(self.memo) - before:
                    del self.memo[stale]
            else:
                self.stop(
                    function.module,
                    function.node.lineno,
                    name,
                    f"what its recursive calls give did not settle in {RECURSION_ROUNDS} rounds",
                )
        finally:
            self.active.discard(key)
            self.recursed.discard(key)
            self.assumed.pop(key, None)
        self.memo[key] = result
        return result

    def store(self, where: str, taint: Taint, site: str = "") -> None:
        if taint and not taint <= self.stores.get(where, CLEAN):
            self.stores[where] = self.stores.get(where, CLEAN) | taint
            self.stores_changed = True
            self.changed_stores.add(where)
            if site:
                self.store_sites[where] = site

    def run(self) -> list[Flow]:
        """Every flow, from every function analysed as an entry (its parameters carrying nothing drawn), until what
        the stores hold settles. Unfinished if the analysis stopped anywhere (``stops``) or the stores did not
        settle."""
        for _ in range(STORE_ROUNDS):
            self.stores_changed = False
            self.changed_stores.clear()
            self.stops.clear()
            self.memo.clear()
            flows: dict[tuple[str, int, str], Flow] = {}
            for name, function in self.functions.items():
                if name in SOURCES:
                    continue
                for flow in self.analyse(name, tuple(frozenset() for _ in function.params)).flows:
                    known = flows.get((flow.where, flow.line, flow.what))
                    if known is None:
                        flows[(flow.where, flow.line, flow.what)] = flow
                    else:
                        flows[(flow.where, flow.line, flow.what)] = Flow(
                            known.where, known.line, known.what, known.origins | flow.origins, known.path or flow.path
                        )
            if not self.stores_changed:
                if self.stops:
                    raise Unfinished([f"{where}: {why}. {UNFINISHED_FIX}" for where, why in sorted(self.stops.items())])
                return sorted(flows.values(), key=lambda flow: (flow.where, flow.line, flow.what))
        raise Unfinished(
            [
                f"{self.store_sites.get(where, 'python-backend')}: what the store {where} holds did not settle in "
                f"{STORE_ROUNDS} rounds. {UNFINISHED_FIX}"
                for where in sorted(self.changed_stores)
            ]
            or [f"python-backend: what the stores hold did not settle in {STORE_ROUNDS} rounds. {UNFINISHED_FIX}"]
        )


#: What a field written in a function is (Walker.field_kind): an array of drawn points (a drawn value may go in it, and
#: what goes in it must come from a thinning function), another field of a picture's drawn points (a holder of such
#: arrays, or their places), or any other field (no drawn value may go in it).
ARRAY_FIELD, DRAWN_FIELD, OTHER_FIELD = "array", "drawn", "other"


def _dereferenced(node: object, definitions: Mapping[str, object], depth: int = 4) -> object:
    """``node`` with each ``{"$ref": "#/$defs/X"}`` in it replaced by the definition X (``depth`` levels deep)."""
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and depth > 0:
            return _dereferenced(definitions.get(ref.rsplit("/", 1)[-1], {}), definitions, depth - 1)
        return {key: _dereferenced(value, definitions, depth) for key, value in node.items()}
    if isinstance(node, list):
        return [_dereferenced(value, definitions, depth) for value in node]
    return node


def property_kind(key: str, prop: object, definitions: Mapping[str, object]) -> str:
    """What the schema's property ``key`` (``prop``) of a definition is: ARRAY_FIELD, DRAWN_FIELD or OTHER_FIELD."""
    one = {"properties": {key: _dereferenced(prop, definitions)}}
    arrays, holders = schema_fields(one, "x-drawn")
    if key in arrays:
        return ARRAY_FIELD
    places, _ = schema_fields(one, "x-place")
    return DRAWN_FIELD if key in holders or (key in places and key in DRAWN_PLACES) else OTHER_FIELD


def _number_literal(node: ast.expr) -> bool:
    """A number written out (``2048``, ``-1.5``), not a bool."""
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        node = node.operand
    return isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool)


def scalar_annotation(node: ast.expr) -> bool:
    """Whether an annotation is of one scalar (``float``, ``int | None``, ``NotRequired[float]``): no array."""
    if isinstance(node, ast.Constant):
        return node.value is None
    if isinstance(node, ast.Name):
        return node.id in SCALAR_TYPES
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return scalar_annotation(node.left) and scalar_annotation(node.right)
    if (
        isinstance(node, ast.Subscript)
        and isinstance(node.value, ast.Name)
        and node.value.id in ("NotRequired", "Required", "Optional")
    ):
        return scalar_annotation(node.slice)
    return False


class Walker:
    """One function's body, followed statement by statement."""

    def __init__(self, program: Program, function: Function) -> None:
        self.program = program
        self.function = function
        self.module = function.module
        self.env: dict[str, Taint] = {}
        self.local_defs: dict[str, ast.FunctionDef | ast.AsyncFunctionDef] = {}
        self.inside: set[str] = set()
        #: Names bound to a literal of field names (``same = ("kind", "x")``) and the loop names over one
        #: (``for key in same``): ``view.get(key)`` is those fields, not the whole view.
        self.names: dict[str, tuple[str, ...]] = {}
        #: The closures (see FUNCTION) this walk made: called here, they see the names as they are now.
        self.own: set[str] = set()
        #: A local def's result so far while a recursive call of it is followed again (``local_call``).
        self.local_assumed: dict[str, Taint] = {}
        self.local_recursed: set[str] = set()
        #: The line of the statement being followed (where a store is added to, where the analysis stops).
        self.line = function.node.lineno
        #: What answer this function builds, by its return annotation (Program.answer).
        self.answer = program.answer(function)
        #: The dicts that are an answer of a known type (the dict returned, or a local annotated with one), and the
        #: locals holding one: only their own fields are classified by that type (field_kind).
        self.typed_dicts: dict[int, tuple[str, str]] = {}
        self.typed_names: dict[str, tuple[str, str]] = {}
        self._type_answers(function.node)
        self.returned: Taint = CLEAN
        self.flows: list[Flow] = []
        #: What this function puts in a store of its parameters' values, for its caller to store as its own.
        self.pending: list[tuple[str, Taint]] = []

    def stop(self, node: ast.AST | None, why: str) -> None:
        """The analysis cannot follow ``node`` (see Unfinished): it fails here, naming the place."""
        self.program.stop(self.module, getattr(node, "lineno", self.line), self.function.name, why)

    def store(self, where: str, taint: Taint) -> None:
        site = f"python-backend/{self.module}.py:{self.line} {self.function.name.split(':', 1)[-1]}"
        self.program.store(where, frozenset(pair for pair in taint if not pair[1].startswith("@")), site)
        mine = frozenset(pair for pair in taint if pair[1].startswith("@"))
        if mine:
            self.pending.append((where, mine))

    def computes(self, taint: Taint, node: ast.AST | None = None) -> None:
        """This function's own code computes with ``taint``: a reader of drawn points, if any are in it."""
        used = frozenset(origin for _, origin in taint if kind_of(origin) in (DRAWN, THINNED, DECIDED))
        if used:
            given = {source_of(origin) for origin in used if not origin.startswith(("@", TAG))}
            self.program.readers.setdefault(self.function.name, set()).update(given or {"(its caller's)"})

    def flow(self, node: ast.AST, what: str, taint: Taint) -> None:
        self.flows.append(Flow(self.function.name, getattr(node, "lineno", 0), what, frozenset(o for _, o in taint)))

    # --- statements --------------------------------------------------------------------------------------

    def block(self, body: Iterable[ast.stmt]) -> None:
        for statement in body:
            self.statement(statement)

    def branches(self, *bodies: list[ast.stmt]) -> None:
        start = dict(self.env)
        merged: dict[str, Taint] = {}
        for body in bodies:
            self.env = dict(start)
            self.block(body)
            for name, taint in self.env.items():
                merged[name] = merged.get(name, CLEAN) | taint
        self.env = merged

    def loop(self, node: ast.stmt, body: list[ast.stmt], bind: ast.expr | None = None, taint: Taint = CLEAN) -> None:
        for _ in range(LOOP_ROUNDS):
            before = dict(self.env)
            if bind is not None:
                names = self.names.get(bind.id) if isinstance(bind, ast.Name) else None
                self.assign(bind, taint, None)
                if names is not None and isinstance(bind, ast.Name):
                    self.names[bind.id] = names
            self.branches(body, [])
            if self.env == before:
                return
        self.stop(node, f"what this loop's names carry did not settle in {LOOP_ROUNDS} rounds")

    def statement(self, node: ast.stmt) -> None:
        self.line = node.lineno
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self.local_defs[node.name] = node
            self.env.pop(node.name, None)
        elif isinstance(node, ast.Assign):
            value = self.expr(node.value)
            for target in node.targets:
                self.assign(target, value, node.value)
        elif isinstance(node, ast.AnnAssign):
            if node.value is not None:
                self.assign(node.target, self.expr(node.value), node.value)
        elif isinstance(node, ast.AugAssign):
            value, current = self.expr(node.value), self.expr(node.target)
            if isinstance(node.op, ast.Sub):
                self.difference(node, current, value)
            self.assign(node.target, flat(current | value), None)
        elif isinstance(node, ast.Return):
            if node.value is not None:
                self.returned |= self.expr(node.value)
        elif isinstance(node, ast.Expr):
            self.expr(node.value)
        elif isinstance(node, ast.If):
            self.expr(node.test)
            self.branches(node.body, node.orelse)
        elif isinstance(node, (ast.For, ast.AsyncFor)):
            self.key_of(node.target, node.iter)
            self.loop(node, node.body, node.target, self.expr(node.iter))
            self.block(node.orelse)
        elif isinstance(node, ast.While):
            self.expr(node.test)
            self.loop(node, node.body)
            self.block(node.orelse)
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                value = self.expr(item.context_expr)
                if item.optional_vars is not None:
                    self.assign(item.optional_vars, value, None)
            self.block(node.body)
        elif isinstance(node, (ast.Try, ast.TryStar)):
            self.block(node.body)
            self.branches(*[handler.body for handler in node.handlers], node.orelse, [])
            self.block(node.finalbody)
        elif isinstance(node, ast.Match):
            subject = flat(self.expr(node.subject))
            bodies = []
            for case in node.cases:
                # Every name a pattern captures holds what the subject holds (or part of it).
                captured = [
                    pattern.name
                    for pattern in ast.walk(case.pattern)
                    if isinstance(pattern, (ast.MatchAs, ast.MatchStar)) and pattern.name
                ] + [
                    pattern.rest
                    for pattern in ast.walk(case.pattern)
                    if isinstance(pattern, ast.MatchMapping) and pattern.rest
                ]
                for name in captured:
                    self.env[name] = self.env.get(name, CLEAN) | subject
                if case.guard is not None:
                    self.expr(case.guard)
                bodies.append(case.body)
            self.branches(*bodies, [])
        elif isinstance(node, (ast.Raise, ast.Assert, ast.Delete)):
            for child in ast.iter_child_nodes(node):
                if isinstance(child, ast.expr):
                    self.expr(child)
        elif isinstance(node, INERT_STATEMENTS):
            pass
        else:
            self.stop(node, f"a {type(node).__name__} statement inside a function is not followed")

    def field_names(self, node: ast.expr | None) -> tuple[str, ...] | None:
        """The field names ``node`` is a literal of (or a name bound to one), if it is."""
        if isinstance(node, ast.Name):
            return self.names.get(node.id)
        if isinstance(node, (ast.Tuple, ast.List, ast.Set)) and node.elts:
            items = [self.constant(item) for item in node.elts]
            if all(isinstance(item, str) for item in items):
                return tuple(str(item) for item in items)
        return None

    def key_of(self, target: ast.expr, iterated: ast.expr) -> None:
        """``target`` bound by a loop over ``iterated``: each of its field names, if it is a literal of them."""
        names = self.field_names(iterated)
        if isinstance(target, ast.Name):
            if names is not None:
                self.names[target.id] = names
            else:
                self.names.pop(target.id, None)

    def element_at(self, taint: Taint, key: ast.expr) -> Taint:
        """``value[key]``: a field by a constant name, or each field a loop name takes."""
        names = self.names.get(key.id) if isinstance(key, ast.Name) else None
        if names is None:
            return element(taint, self.constant(key))
        out: Taint = CLEAN
        for name in names:
            out |= element(taint, name)
        return out

    def assign(self, target: ast.expr, taint: Taint, value: ast.expr | None) -> None:
        if isinstance(target, ast.Name):
            self.env[target.id] = taint
            names = self.field_names(value) if value is not None and not isinstance(value, ast.Name) else None
            if names is not None:
                self.names[target.id] = names
            else:
                self.names.pop(target.id, None)
        elif isinstance(target, (ast.Tuple, ast.List)):
            same = isinstance(value, (ast.Tuple, ast.List)) and len(value.elts) == len(target.elts)
            for index, item in enumerate(target.elts):
                if isinstance(item, ast.Starred):
                    self.assign(item.value, element(taint, None), None)
                elif same:
                    part = value.elts[index]  # type: ignore[union-attr]
                    self.assign(item, self.expr(part), part)
                else:
                    self.assign(item, element(taint, index), None)
        elif isinstance(target, ast.Subscript):
            key = self.constant(target.slice)
            self.expr(target.slice)
            if not self.is_store(target.value):
                self.check_field(target, key, taint, self.typed_holder(target.value))
            self.put(target.value, nested(taint, key))
        elif isinstance(target, ast.Attribute):
            self.put(target, flat(taint))
        elif isinstance(target, ast.Starred):
            self.assign(target.value, taint, None)

    def put(self, target: ast.expr, taint: Taint) -> None:
        """``taint`` added to what ``target`` holds (a container a value was put into)."""
        if not taint:
            return
        if isinstance(target, ast.Name):
            store = self.store_of(target.id)
            if store is not None:
                self.store(store, taint)
            else:
                self.env[target.id] = self.env.get(target.id, CLEAN) | taint
        elif isinstance(target, ast.Attribute):
            if isinstance(target.value, ast.Name) and target.value.id == "self" and self.function.cls:
                self.store(f"{self.module}:{self.function.cls}.{target.attr}", taint)
            else:
                self.put(target.value, nested(taint, target.attr))
        elif isinstance(target, ast.Subscript):
            self.put(target.value, flat(taint))

    def store_of(self, name: str) -> str | None:
        """The module-level store a name is here (this module's global, or one imported from another), if it is one."""
        if name in self.env:
            return None
        module = self.program.modules[self.module]
        if name in module.globals:
            return f"{self.module}:{name}"
        imported = module.imported.get(name)
        if imported is not None and imported.split(":")[1] in self.program.modules[imported.split(":")[0]].globals:
            return imported
        return None

    def is_store(self, node: ast.expr) -> bool:
        """Whether ``node`` is a store (a module-level one, or an attribute of ``self``) rather than an answer."""
        if isinstance(node, ast.Name):
            return self.store_of(node.id) is not None
        return isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "self"

    def _type_answers(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        """Which dicts of this function are an answer of a known type: a dict returned (the return annotation's
        type), a local annotated with a type (``view: StageView = {...}``), and a local returned. A scalar type says
        nothing of the dicts inside (a function that returns None or a string may still send a picture)."""
        statements: list[ast.AST] = []
        todo: list[ast.AST] = list(node.body)
        while todo:
            item = todo.pop()
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                continue
            statements.append(item)
            todo.extend(ast.iter_child_nodes(item))
        answer = self.answer if self.answer is not None and self.answer[0] != "none" else None
        assigned: list[tuple[str, ast.expr]] = []
        for item in statements:
            if isinstance(item, ast.Return) and answer is not None:
                # What is returned, through ``a if c else b`` and ``a or b``: each side is the answer.
                returned = [item.value] if item.value is not None else []
                while returned:
                    value = returned.pop()
                    if isinstance(value, ast.Dict):
                        self.typed_dicts[id(value)] = answer
                    elif isinstance(value, ast.Name):
                        self.typed_names[value.id] = answer
                    elif isinstance(value, ast.IfExp):
                        returned.extend((value.body, value.orelse))
                    elif isinstance(value, ast.BoolOp):
                        returned.extend(value.values)
            elif isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                typed = self.program.typed(self.module, item.annotation)
                if typed is not None and typed[0] != "none":
                    self.typed_names[item.target.id] = typed
                if item.value is not None:
                    assigned.append((item.target.id, item.value))
            elif isinstance(item, ast.Assign):
                assigned.extend((t.id, item.value) for t in item.targets if isinstance(t, ast.Name))
        for name, value in assigned:
            if name in self.typed_names and isinstance(value, ast.Dict):
                self.typed_dicts[id(value)] = self.typed_names[name]

    def typed_holder(self, node: ast.expr) -> tuple[str, str] | None:
        """The type of the answer ``node`` (the dict written into) is, if a local of a known type."""
        return self.typed_names.get(node.id) if isinstance(node, ast.Name) else None

    def number(self, node: ast.AST) -> bool:
        """A number written out, or a module-level name bound to one (``sv.EVENT_POINTS``): never an array."""
        if isinstance(node, ast.expr) and _number_literal(node):
            return True
        module = self.program.modules[self.module]
        if isinstance(node, ast.Name) and node.id not in self.env:
            found = module.imported.get(node.id, f"{self.module}:{node.id}")
            return found in self.program.numbers
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in module.aliases:
            return f"{module.aliases[node.value.id]}:{node.attr}" in self.program.numbers
        return False

    def field_kind(self, key: str, answer: tuple[str, str] | None = None) -> str:
        """What the field ``key`` written here is, by module, function and field: in an answer of a known type (the
        dict this function returns, by its return annotation, or a local annotated with a type: ``answer``), what
        that type says (a schema definition's property, a backend class's field); anywhere else, and for a field the
        type does not have, the field taken by its name (DRAWN_ARRAYS, DRAWN_KEYS)."""
        if answer is not None:
            kind, name = answer
            if kind == "schema":
                properties = self.program.definitions[name].get("properties")
                prop = properties.get(key) if isinstance(properties, dict) else None
                if prop is not None:
                    return property_kind(key, prop, self.program.definitions)
            if kind == "record":
                annotation = self.program.annotations[name].get(key)
                if annotation is not None and scalar_annotation(annotation):
                    return OTHER_FIELD
        return ARRAY_FIELD if key in DRAWN_ARRAYS else DRAWN_FIELD if key in DRAWN_KEYS else OTHER_FIELD

    def check_field(self, node: ast.AST, key: object, taint: Taint, answer: tuple[str, str] | None = None) -> None:
        """A drawn value itself (not a picture holding drawn fields) put under a field that is not a drawn one; a
        value no thinning function gave put under a field that is an array of drawn points (a number written out is
        no array). ``answer``: the type of the answer the field is written into, if known (field_kind)."""
        if not isinstance(key, str):
            return
        kind = self.field_kind(key, answer)
        if kind == ARRAY_FIELD and not values_of(taint) and not self.nothing(node) and not self.number(node):
            where = f"{self.function.name}#{key}"
            line = getattr(node, "lineno", 0)
            self.program.unthinned[where] = min(self.program.unthinned.get(where, line), line)
        drawn = bare(values_of(taint))
        if kind == OTHER_FIELD and drawn:
            self.flow(node, f"field {key!r} = drawn points", drawn)
        decided = bare(decisions_of(taint))
        if kind == OTHER_FIELD and decided:
            self.flow(node, f"field {key!r} = decided by drawn points", decided)

    @staticmethod
    def nothing(node: ast.AST) -> bool:
        """An empty list or tuple, or None, written out: a field with no points in it."""
        if isinstance(node, ast.List | ast.Tuple):
            return not node.elts
        return isinstance(node, ast.Constant) and node.value is None

    def reduction(self, node: ast.Call, what: str, taint: Taint, along_axis: bool) -> Taint:
        """A reduction of ``taint``: a flow if it reduces drawn points, or thinned ones to one number."""
        self.computes(taint, node)
        flowing = frozenset(
            pair
            for pair in taint
            if kind_of(pair[1]) in (DRAWN, DECIDED) or (kind_of(pair[1]) == THINNED and not along_axis)
        )
        if flowing:
            self.flow(node, what, flowing)
        return flat(rekind(taint, lambda kind: THINNED if kind == BUCKET else kind))

    def difference(self, node: ast.AST, left: Taint, right: Taint) -> None:
        if values_of(left) and values_of(right):
            self.flow(node, f"Δ {_short(node)}", values_of(left) | values_of(right))

    @staticmethod
    def constant(node: ast.expr) -> object:
        return node.value if isinstance(node, ast.Constant) else None

    # --- functions as values ---------------------------------------------------------------------------

    def function_value(self, node: ast.expr) -> str | None:
        """The function ``node`` names here, as an origin (FUNCTION), if it names one and no local is in the way."""
        if isinstance(node, ast.Name) and node.id in self.env:
            return None
        if isinstance(node, ast.Name) and node.id in self.local_defs:
            return self.closure(self.local_defs[node.id])
        return self.program.named_function(self.module, self.function.cls, node)

    def closure(self, node: ast.Lambda | ast.FunctionDef | ast.AsyncFunctionDef) -> str:
        """A lambda or local def made a value here: its origin, with what the names it sees hold (Closure). One made
        where its names hold other values is another closure: what it carries never mixes with the other's."""
        used = {inner.id for inner in ast.walk(node) if isinstance(inner, ast.Name)}
        seen = {
            name: frozenset(pair for pair in taint if not pair[1].startswith("@"))
            for name, taint in self.env.items()
            if name in used
        }
        held = repr(sorted((name, sorted(taint)) for name, taint in seen.items()))
        digest = hashlib.sha1(held.encode()).hexdigest()[:12]
        ident = f"closure:{self.function.name}:{node.lineno}:{node.col_offset}:{digest}"
        if ident not in self.program.closures:
            self.program.closures[ident] = Closure(node, self.function, seen, dict(self.local_defs))
        self.own.add(ident)
        return f"{FN}{ident}|{FUNCTION}"

    @staticmethod
    def functions_in(taint: Taint) -> list[str]:
        """The functions a value is (its FUNCTION origins as the whole value)."""
        return sorted({origin for name, origin in taint if name == WHOLE and kind_of(origin) == FUNCTION})

    def given(self, node: ast.AST, taint: Taint, what: str) -> None:
        """A call of something the analysis cannot resolve to a function (``what``): drawn points or a decision of
        them given to it stop the analysis here (Unfinished), as it cannot say what is made of them."""
        if values_of(taint) or decisions_of(taint):
            self.stop(node, f"drawn points are given to {what}, which the analysis cannot resolve to a function")

    def call_value(
        self, node: ast.Call, value: Taint, what: str, args: list[Taint], keywords: dict[str | None, Taint]
    ) -> Taint:
        """A call of a value (a local, a parameter, an item of a tuple): each function it is, called; none, and it
        is a value the analysis cannot resolve (given)."""
        every = frozenset().union(*args, *keywords.values())
        functions = self.functions_in(value)
        if not functions:
            self.given(node, every, what)
            return flat(value | every)
        out = CLEAN
        for origin in functions:
            out |= self.invoke(node, origin, args, keywords)
        return out

    def invoke(self, node: ast.Call, origin: str, args: list[Taint], keywords: dict[str | None, Taint]) -> Taint:
        """The function ``origin`` (FUNCTION) called at ``node`` with ``args``: as a call of it by its name."""
        what = source_of(origin)[len(FN) :]
        every = frozenset().union(*args, *keywords.values())
        if what.startswith("closure:"):
            return self.closure_call(node, what, args, keywords)
        if what.startswith("np."):
            func: ast.expr = ast.Name("np", ast.Load())
            for part in what.split(".")[1:]:
                func = ast.Attribute(func, part, ast.Load())
            called = ast.copy_location(ast.Call(func, node.args, node.keywords), node)
            return self.method(called, func, args, keywords, every)  # type: ignore[arg-type]
        if what.startswith("builtins."):
            return self.builtin(node, what.split(".", 1)[1], args, keywords, every, local=False)
        made = self.backend_call(node, what, args, keywords, method=False)
        return flat(every) if made is None else made

    def closure_call(self, node: ast.Call, ident: str, args: list[Taint], keywords: dict[str | None, Taint]) -> Taint:
        """A lambda or local def called through a value: here as it is now if this walk made it, else in the function
        that made it, seeing what its names held there."""
        closure = self.program.closures.get(ident)
        every = frozenset().union(*args, *keywords.values())
        if closure is None or ident in self.program.calling:
            self.given(node, every, "a function value that calls itself")
            return flat(every)
        if ident in self.own:
            if isinstance(closure.node, ast.Lambda):
                return self.lambda_call(closure.node, args, keywords)
            if self.local_defs.get(closure.node.name) is closure.node:
                return self.local_call(closure.node.name, args, keywords)
        self.program.calling.add(ident)
        try:
            walker = Walker(self.program, closure.function)
            walker.env, walker.local_defs = dict(closure.env), dict(closure.local_defs)
            if isinstance(closure.node, ast.Lambda):
                taint = walker.lambda_call(closure.node, args, keywords)
            else:
                walker.local_defs[closure.node.name] = closure.node
                taint = walker.local_call(closure.node.name, args, keywords)
        finally:
            self.program.calling.discard(ident)
        self.flows.extend(walker.flows)
        self.pending.extend(walker.pending)
        return taint

    def lambda_call(self, lam: ast.Lambda, args: list[Taint], keywords: dict[str | None, Taint]) -> Taint:
        """A lambda called with ``args``: its body followed here, with the closure as it is now."""
        saved = dict(self.env)
        params = [a.arg for a in [*lam.args.posonlyargs, *lam.args.args, *lam.args.kwonlyargs]]
        for index, param in enumerate(params):
            self.env[param] = args[index] if index < len(args) else keywords.get(param, CLEAN)
        if lam.args.vararg is not None:
            self.env[lam.args.vararg.arg] = flat(frozenset().union(*args[len(params) :]))
        taint = self.expr(lam.body)
        self.env = saved
        return taint

    def handed(self, node: ast.Call, args: list[Taint], keywords: dict[str | None, Taint]) -> Taint:
        """A function handed to a call that is not the backend's (``map(np.max, rows)``, ``key=np.abs``,
        ``np.apply_along_axis(np.median, 0, drawn)``): called on the call's other arguments, what it gives."""
        handed = [*node.args, *(keyword.value for keyword in node.keywords)]
        taints = [*args, *keywords.values()]
        out = CLEAN
        for index, taint in enumerate(taints):
            # A NumPy function handed on matters where it makes a number (a reduction, a Δ); a NumPy type
            # (``dtype=np.float64``) or another function only converts what it is given.
            functions = [
                origin
                for origin in self.functions_in(taint)
                if not source_of(origin).startswith(f"{FN}np.")
                or source_of(origin).rsplit(".", 1)[-1] in REDUCERS | {"subtract"}
            ]
            if not functions:
                continue
            others = [other for at, other in enumerate(handed) if at != index]
            given = frozenset().union(*(other for at, other in enumerate(taints) if at != index))
            if not values_of(given) and not decisions_of(given):
                # Given nothing drawn, only a lambda or a local def can give drawn points (what it holds).
                functions = [origin for origin in functions if source_of(origin).startswith(f"{FN}closure:")]
            # The other arguments as one, spelled as they are written (a flow names them so).
            spelled = ast.Name(", ".join(_short(other) for other in others), ast.Load())
            called = ast.copy_location(ast.Call(handed[index], [spelled], []), node)
            for origin in functions:
                out |= self.invoke(called, origin, [given], {})
        return out

    # --- expressions -------------------------------------------------------------------------------------

    def expr(self, node: ast.expr | None) -> Taint:
        if node is None:
            return CLEAN
        method = getattr(self, f"_{type(node).__name__}", None)
        if method is not None:
            return method(node)
        taint = CLEAN
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.expr):
                taint |= flat(self.expr(child))
        return taint

    def _Constant(self, node: ast.Constant) -> Taint:
        return CLEAN

    def _Lambda(self, node: ast.Lambda) -> Taint:
        # A function value (FUNCTION): followed where it is called (``key=lambda i: drawn[i]``, handed).
        return frozenset({(WHOLE, self.closure(node))})

    def _Compare(self, node: ast.Compare) -> Taint:
        # Not a value but a decision: of drawn points, it is followed as one (C) to where it is sent or counted. A
        # presence test (``is None``, ``in``, ``== []``) says only whether there is anything: no decision of values.
        taint = self.expr(node.left)
        for comparator in node.comparators:
            taint |= self.expr(comparator)
        presence = all(isinstance(op, (ast.Is, ast.IsNot, ast.In, ast.NotIn)) for op in node.ops) or any(
            isinstance(side, (ast.Constant, ast.List, ast.Tuple, ast.Dict))
            and not getattr(side, "elts", None)
            and not isinstance(getattr(side, "value", None), (int, float))
            for side in [node.left, *node.comparators]
        )
        if presence:
            return CLEAN
        self.computes(taint, node)
        return decided(taint)

    def _UnaryOp(self, node: ast.UnaryOp) -> Taint:
        taint = self.expr(node.operand)
        return CLEAN if isinstance(node.op, ast.Not) else taint

    def _JoinedStr(self, node: ast.JoinedStr) -> Taint:
        for child in ast.walk(node):
            if isinstance(child, ast.FormattedValue):
                self.expr(child.value)
        return CLEAN

    def _Name(self, node: ast.Name) -> Taint:
        if node.id in self.env:
            return self.env[node.id]
        function = self.function_value(node)
        if function is not None:
            return frozenset({(WHOLE, function)})
        store = self.store_of(node.id)
        return self.program.stores.get(store, CLEAN) if store else CLEAN

    def _Attribute(self, node: ast.Attribute) -> Taint:
        if node.attr in SHAPE_ATTRIBUTES:
            self.expr(node.value)
            return CLEAN
        function = self.function_value(node)
        if function is not None:
            return frozenset({(WHOLE, function)})
        if isinstance(node.value, ast.Name) and node.value.id == "self" and self.function.cls:
            return self.program.stores.get(f"{self.module}:{self.function.cls}.{node.attr}", CLEAN)
        return element(self.expr(node.value), node.attr)

    def _Subscript(self, node: ast.Subscript) -> Taint:
        value = self.element_at(self.expr(node.value), node.slice)
        index = self.expr(node.slice)
        # Values taken at a bucket's positions are that bucket; at drawn points' indices, drawn points.
        return value | flat(rekind(index, lambda kind: BUCKET if kind == POSITIONS else kind))

    def _Tuple(self, node: ast.Tuple) -> Taint:
        taint = CLEAN
        for index, item in enumerate(node.elts):
            taint |= nested(self.expr(item), f"#{index}")
        return taint

    def _List(self, node: ast.List | ast.Set) -> Taint:
        taint = CLEAN
        for item in node.elts:
            taint |= self.expr(item)
        return taint

    _Set = _List

    def _Dict(self, node: ast.Dict) -> Taint:
        taint = CLEAN
        for key, value in zip(node.keys, node.values, strict=True):
            carried = self.expr(value)
            if key is None:
                taint |= carried
                continue
            name = self.constant(key)
            self.expr(key)
            self.check_field(value, name, carried, self.typed_dicts.get(id(node)))
            taint |= nested(carried, name)
        return taint

    def _BinOp(self, node: ast.BinOp) -> Taint:
        left, right = self.expr(node.left), self.expr(node.right)
        self.computes(left | right, node)
        if isinstance(node.op, ast.Sub):
            self.difference(node, left, right)
        return flat(left | right)

    def _IfExp(self, node: ast.IfExp) -> Taint:
        self.expr(node.test)
        return self.expr(node.body) | self.expr(node.orelse)

    def _NamedExpr(self, node: ast.NamedExpr) -> Taint:
        taint = self.expr(node.value)
        self.assign(node.target, taint, node.value)
        return taint

    def _Starred(self, node: ast.Starred) -> Taint:
        return self.expr(node.value)

    def comprehension(self, generators: list[ast.comprehension]) -> dict[str, Taint]:
        saved = dict(self.env)
        for generator in generators:
            self.assign(generator.target, self.expr(generator.iter), None)
            self.key_of(generator.target, generator.iter)
            for condition in generator.ifs:
                self.expr(condition)
        return saved

    def _ListComp(self, node: ast.ListComp | ast.SetComp | ast.GeneratorExp) -> Taint:
        saved = self.comprehension(node.generators)
        taint = self.expr(node.elt)
        self.env = saved
        return taint

    _SetComp = _ListComp
    _GeneratorExp = _ListComp

    def _DictComp(self, node: ast.DictComp) -> Taint:
        copied = self.copied_fields(node)
        if copied is not None:
            return copied
        saved = self.comprehension(node.generators)
        self.expr(node.key)
        # Its keys are not known here: each value keeps its fields, read back by a key that is not known either.
        taint = self.expr(node.value)
        self.env = saved
        return taint

    def copied_fields(self, node: ast.DictComp) -> Taint | None:
        """``{k: v for k, v in d.items() if k not in (...)}``: ``d``'s fields, but those left out."""
        if len(node.generators) != 1:
            return None
        generator = node.generators[0]
        target, source = generator.target, generator.iter
        if not (
            isinstance(target, ast.Tuple)
            and len(target.elts) == 2
            and isinstance(source, ast.Call)
            and isinstance(source.func, ast.Attribute)
            and source.func.attr == "items"
            and isinstance(node.key, ast.Name)
            and isinstance(node.value, ast.Name)
            and [node.key.id, node.value.id] == [getattr(item, "id", None) for item in target.elts]
        ):
            return None
        left_out: set[str] = set()
        for condition in generator.ifs:
            if (
                isinstance(condition, ast.Compare)
                and isinstance(condition.ops[0], ast.NotIn)
                and isinstance(condition.left, ast.Name)
                and condition.left.id == node.key.id
                and isinstance(condition.comparators[0], (ast.Tuple, ast.List, ast.Set))
            ):
                left_out.update(str(self.constant(item)) for item in condition.comparators[0].elts)
            else:
                self.expr(condition)
        return frozenset(pair for pair in self.expr(source.func.value) if pair[0] not in left_out)

    @staticmethod
    def along_axis(node: ast.Call, name: str) -> bool:
        return (
            name in ALONG_AXIS
            or any(keyword.arg == "axis" for keyword in node.keywords)
            or (name in AXIS_SECOND and len(node.args) >= 2)
        )

    def _Call(self, node: ast.Call) -> Taint:
        func = node.func
        args = [self.expr(arg) for arg in node.args]
        keywords = {keyword.arg: self.expr(keyword.value) for keyword in node.keywords}
        every = frozenset().union(*args, *keywords.values())
        if isinstance(func, ast.Name) and func.id in self.env:
            # A local or a parameter called: each function it holds (``reduce = np.max``), else not resolved.
            return self.call_value(node, self.env[func.id], func.id, args, keywords)
        if isinstance(func, ast.Name) and func.id not in self.local_defs:
            bound = self.program.modules[self.module].callables.get(func.id)
            function = self.function_value(func) if bound is not None else None
            if function is not None:
                # A module-level name bound to a function (``REDUCE = np.max``, ``from numpy import max as top``).
                return self.invoke(node, function, args, keywords)
        target = self.program.resolve(self.module, self.function.cls, func)
        if target is None or target not in self.program.functions:
            every |= self.handed(node, args, keywords)
        made = self.backend_call(node, target, args, keywords, method=isinstance(func, ast.Attribute))
        if made is not None:
            return made
        if isinstance(func, ast.Name):
            return self.builtin(node, func.id, args, keywords, every)
        if isinstance(func, ast.Attribute):
            return self.method(node, func, args, keywords, every)
        # A call of a value made here (``table[key](x)``, ``partial(f, a)(x)``, ``(lambda v: v)(x)``).
        return self.call_value(node, self.expr(func), _short(func), args, keywords)

    def backend_call(
        self, node: ast.Call, target: str | None, args: list[Taint], keywords: dict[str | None, Taint], method: bool
    ) -> Taint | None:
        """A call of the backend's ``target`` (a thinning function, a record, a function), or None if it is none."""
        if target in SOURCES:
            kind, fields = SOURCES[target]
            return frozenset((name, f"{target}|{kind}") for name in fields)
        if target is not None and target in self.program.classes:
            # A record of the backend's: each argument is the field it is given as.
            names = self.program.classes[target]
            made = CLEAN
            for index, taint in enumerate(args):
                made |= nested(taint, names[index]) if index < len(names) else flat(taint)
            for key, taint in keywords.items():
                made |= nested(taint, key) if key else taint
            return made
        if target is not None and target in self.program.functions:
            return self.call(node, target, args, keywords, method=method)
        return None

    def builtin(
        self,
        node: ast.Call,
        name: str,
        args: list[Taint],
        keywords: dict[str | None, Taint],
        every: Taint,
        local: bool = True,
    ) -> Taint:
        if local and name in self.local_defs:
            return self.local_call(name, args, keywords)
        if name in BUILTIN_REDUCERS:
            return self.reduction(node, f"{name}({', '.join(_short(a) for a in node.args)})", every, False)
        if name in ("bool", "all", "any"):
            # A truth of drawn points: a decision, followed to where it is sent or counted (a branch on it is not).
            return decided(every)
        if name in CLEAN_BUILTINS:
            return CLEAN
        if name == "enumerate" and args:
            return nested(args[0], "#1")
        if name == "zip":
            taint = CLEAN
            for index, arg in enumerate(args):
                taint |= nested(arg, f"#{index}")
            return taint
        if name in ("replace", "dict") and args:
            # dataclasses.replace(obj, field=value), dict(mapping, key=value): the fields as given.
            taint = args[0]
            for key, carried in keywords.items():
                taint |= nested(carried, key) if key else carried
            return taint
        return flat(every)

    def method(
        self,
        node: ast.Call,
        func: ast.Attribute,
        args: list[Taint],
        keywords: dict[str | None, Taint],
        every: Taint,
    ) -> Taint:
        name = func.attr
        if self.program.is_numpy(self.module, func.value):
            if name in REDUCERS:
                what = f"np.{name}({', '.join(_short(a) for a in node.args)})"
                return self.reduction(node, what, every, self.along_axis(node, name))
            if name == "subtract" and len(args) >= 2:
                self.difference(node, args[0], args[1])
            if name not in ARRANGING:
                self.computes(every, node)
            return flat(every)
        receiver = self.expr(func.value)
        if name in REDUCERS:
            what = f"{_short(func.value)}.{name}()"
            return self.reduction(node, what, receiver, self.along_axis(node, name) or bool(node.args)) | flat(every)
        if name == "get" and node.args:
            return self.element_at(receiver, node.args[0]) | (args[1] if len(args) > 1 else CLEAN)
        if name == "update":
            stored = CLEAN
            for taint in args:
                stored |= taint
            for key, taint in keywords.items():
                if key is not None:
                    self.check_field(node, key, taint, self.typed_holder(func.value))
                stored |= nested(taint, key) if key else taint
            self.put(func.value, stored)
            return CLEAN
        if name.startswith(STORING_METHODS):
            if name == "__setitem__" and len(node.args) == 2:
                self.check_field(node, self.constant(node.args[0]), args[1], self.typed_holder(func.value))
            self.put(func.value, every)
            return CLEAN
        if name in ("copy", "values"):
            return receiver
        if name == "items":
            return nested(receiver, "#1")
        if name == "keys":
            return CLEAN
        return flat(receiver | every)

    def call(
        self, node: ast.Call, target: str, args: list[Taint], keywords: dict[str | None, Taint], method: bool
    ) -> Taint:
        """A call of a backend function: followed into it with what each argument carries."""
        function = self.program.functions[target]
        if len(self.program.active) >= CALL_DEPTH:
            self.stop(node, f"the call of {target} is {CALL_DEPTH} calls deep, deeper than the analysis follows")
            return flat(frozenset().union(*args, *keywords.values()))
        offset = 1 if method and function.params[:1] in (["self"], ["cls"]) else 0
        bound: list[Taint] = [CLEAN] * len(function.params)
        spill = CLEAN
        for index, (arg, taint) in enumerate(zip(node.args, args, strict=True)):
            if isinstance(arg, ast.Starred) or offset + index >= len(function.params):
                spill |= flat(taint)
            else:
                bound[offset + index] = taint
        for name, taint in keywords.items():
            if name in function.params:
                bound[function.params.index(name)] |= taint
            else:
                spill |= flat(taint)
        if spill:
            bound = [taint | spill for taint in bound]
        context = tuple(
            frozenset((f, o if kind_of(o) == FUNCTION else kind_of(o)) for f, o in taint) for taint in bound
        )
        summary = self.program.analyse(target, context)

        def callers(origin: str) -> list[Pair]:
            """The caller's pairs a callee's parameter origin ``@index:kind|…`` stands for."""
            index, kind = origin[1:-2].split(":")
            return [pair for pair in bound[int(index)] if kind_of(pair[1]) == kind]

        def own(taint: Taint) -> Taint:
            """``taint`` of the callee with this call's origins for its parameters' (the callee followed their
            fields itself: a pair's field is already where they went)."""
            out: set[Pair] = set()
            for name, origin in taint:
                if origin.startswith("@"):
                    out.update((name, with_kind(caller, kind_of(origin))) for _, caller in callers(origin))
                else:
                    out.add((name, origin))
            return frozenset(out)

        for flow in summary.flows:
            real = frozenset(origin for _, origin in own(frozenset((WHOLE, origin) for origin in flow.origins)))
            if real:
                path = (*flow.path, f"{self.function.name}:{node.lineno}")
                self.flows.append(Flow(flow.where, flow.line, flow.what, real, path))
        for where, taint in summary.stores:
            self.store(where, own(taint))
        returned = own(summary.returned)
        if target in self.program.tagged:
            # A 'draws' reader's result of drawn points: followed as its own, to every field it reaches.
            returned |= frozenset(
                (name, f"{TAG}{target}|{kind_of(origin)}")
                for name, origin in returned
                if kind_of(origin) in (DRAWN, THINNED, DECIDED)
            )
        return returned

    def local_call(self, name: str, args: list[Taint], keywords: dict[str | None, Taint]) -> Taint:
        """A def inside this function: its body followed here, with the closure as it is now. A recursive call of it
        gives what it gives so far, and the body is followed again until that settles."""
        if name in self.inside:
            self.local_recursed.add(name)
            return self.local_assumed.get(name, CLEAN)
        definition = self.local_defs[name]
        params = [a.arg for a in [*definition.args.posonlyargs, *definition.args.args, *definition.args.kwonlyargs]]
        returned = CLEAN
        for _ in range(RECURSION_ROUNDS):
            saved_env, saved_returned = dict(self.env), self.returned
            for index, param in enumerate(params):
                self.env[param] = args[index] if index < len(args) else keywords.get(param, CLEAN)
            self.returned = CLEAN
            self.inside.add(name)
            self.block(definition.body)
            self.inside.discard(name)
            returned = self.returned
            self.env, self.returned = saved_env, saved_returned
            if name not in self.local_recursed or returned == self.local_assumed.get(name, CLEAN):
                break
            self.local_assumed[name] = returned
        else:
            self.stop(
                definition, f"what the recursive calls of {name} give did not settle in {RECURSION_ROUNDS} rounds"
            )
        self.local_recursed.discard(name)
        self.local_assumed.pop(name, None)
        return returned


def backend_sources(root: Path = BACKEND) -> dict[str, str]:
    """The backend's modules (not its tests), by module name."""
    found = {}
    for path in sorted(root.rglob("*.py")):
        if path.name.startswith("test_") or path.name == "conftest.py" or "__pycache__" in path.parts:
            continue
        found[path.stem] = path.read_text(encoding="utf-8")
    return found


def find_readers(sources: dict[str, str]) -> dict[str, list[str]]:
    """Every backend function whose own code computes with drawn points, by ``python-backend/module.py:function``
    (the contract table's names), with the decimators they came from: followed through returns, calls, containers
    and stores across modules, not only where a decimator is called."""
    program = Program(sources)
    program.run()
    out: dict[str, list[str]] = {}
    for name, origins in program.readers.items():
        module, function = name.split(":")
        if name in SOURCES:
            continue
        out[f"python-backend/{module}.py:{function.split('.')[-1]}"] = sorted(origins)
    return dict(sorted(out.items()))


def find_flows(sources: dict[str, str]) -> list[Flow]:
    """Every flow of drawn points into a number in ``sources`` (module name → its text)."""
    program = Program(sources)
    missing = [name for name in SOURCES if name.split(":")[0] in sources and name not in program.functions]
    if missing:
        raise SystemExit(f"check_decimation_flow: these thinning functions no longer exist: {', '.join(missing)}")
    return program.run()


def draws_problems(sources: dict[str, str], readers: Iterable[str]) -> list[str]:
    """The backend readers the contract table calls 'draws' (``module:function``) that do more than draw: one
    whose own code makes a number of drawn points, or whose result of drawn points reaches anything but a drawn
    field (DRAWN_KEYS) wherever it goes: another field (a headline, a peak, a range), a reduction, a comparison."""
    named = set(readers)
    program = Program(sources, tagged=named)
    by_last = {name.split(":")[0] + ":" + name.split(":")[1].split(".")[-1]: name for name in program.functions}
    missing = sorted(name for name in named if name not in program.functions and name not in by_last)
    out = [f"python-backend/{name.replace(':', '.py:', 1)}: 'draws', but there is no such function" for name in missing]
    tagged = {by_last.get(name, name) for name in named}
    program.tagged = frozenset(tagged)
    for flow in program.run():
        module, function = flow.where.split(":")
        at = f"python-backend/{module}.py:{flow.line} {function}"
        if flow.where in tagged:
            out.append(f"python-backend/{module}.py:{function.split('.')[-1]}: 'draws', but {flow.what} ({at})")
        for reader in flow.tags:
            if reader == flow.where:
                continue
            mod, func = reader.split(":")
            out.append(
                f"python-backend/{mod}.py:{func.split('.')[-1]}: 'draws', but its result becomes {flow.what} ({at})"
            )
    return sorted(set(out))


def contract() -> dict[str, object]:
    """The backend's drawn-points contract (python-backend/drawn_points_contract.json), which the TS table reads too."""
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def _module_function(entry: str) -> str:
    """``python-backend/module.py:function`` as ``module:function``."""
    path, name = entry.rsplit(":", 1)
    return f"{Path(path).stem}:{name}"


def contract_draws(data: dict[str, object]) -> set[str]:
    """The contract's readers classified 'draws', as ``module:function``."""
    readers = data.get("readers")
    if not isinstance(readers, dict):
        raise SystemExit(f"check_decimation_flow: no 'readers' object in {CONTRACT.name}")
    return {
        _module_function(entry)
        for entry, reader in readers.items()
        if isinstance(reader, dict) and reader.get("use") == "draws"
    }


def contract_decimators(data: dict[str, object]) -> set[str]:
    """The contract's decimators, as ``module:function``."""
    listed = data.get("decimators")
    if not isinstance(listed, list):
        raise SystemExit(f"check_decimation_flow: no 'decimators' list in {CONTRACT.name}")
    return {_module_function(str(entry)) for entry in listed}


def find_unthinned(sources: dict[str, str]) -> dict[str, int]:
    """Every place a value that came from no registered thinning function (SOURCES) is put in a field named as an
    ``x-drawn`` array of the protocol, as ``python-backend/module.py:function#field`` with its line."""
    program = Program(sources)
    program.run()
    out = {}
    for where, line in program.unthinned.items():
        name, key = where.rsplit("#", 1)
        module, function = name.split(":")
        out[f"python-backend/{module}.py:{function}#{key}"] = line  # a method as Class.method: one place each
    return dict(sorted(out.items()))


def contract_unthinned(data: dict[str, object]) -> dict[str, str]:
    """The contract's 'unthinned' entries (``python-backend/module.py:function#field`` → why)."""
    listed = data.get("unthinned")
    if not isinstance(listed, dict):
        raise SystemExit(f"check_decimation_flow: no 'unthinned' object in {CONTRACT.name}")
    return {str(entry): str(why) for entry, why in listed.items()}


def unthinned_problems(found: dict[str, int], listed: dict[str, str]) -> Iterator[str]:
    """What fails: a value put in a drawn field that no registered thinning function gave, unless the contract says
    why it is not thinned; and a contract entry that is no longer found or says no why."""
    for entry, line in found.items():
        if entry not in listed:
            place, key = entry.rsplit("#", 1)
            path, function = place.rsplit(":", 1)
            yield (
                f"{path}:{line} {function}: field {key!r} is an array of drawn points in the protocol (x-drawn), but "
                "what is put in it here came from no registered thinning function. Rule: every value sent in an "
                "x-drawn field is the result of a function listed in SOURCES (scripts/check_decimation_flow.py) and "
                f"'decimators' ({CONTRACT.name}), so that this check follows it. Fix: if the code that made it thins "
                "data to draw it (a slice with a step, a reshape and a min/max, a resample, picked indices), add "
                "that function to both lists. If the field is not a picture's (an answer whose field of this name is "
                "no array of drawn points: a full read's, a range's number), annotate the function's return type with "
                "that answer (its definition in python-backend/protocol_schema.py, or a TypedDict that types the "
                "field), so the field is taken as that answer's. If it is a picture's field and every value is sent, "
                f"none thinned (a band table), add \"{entry}\" to 'unthinned' in {CONTRACT.name} with one sentence "
                "saying why."
            )
    for entry, why in listed.items():
        if entry not in found:
            yield f"'unthinned' in {CONTRACT.name} lists a place no longer found (remove its line): {entry}"
        elif not why.strip():
            yield (
                f"'unthinned' in {CONTRACT.name}: {entry} says no why. Fix: write one sentence there saying why every "
                "value is sent in that field (none thinned)."
            )


def schema_problems(schema: object) -> Iterator[str]:
    """What fails: a place of drawn points (DRAWN_PLACES) that the schema does not mark ``x-place``."""
    places, _ = schema_fields(schema, "x-place")
    for name in sorted(DRAWN_PLACES - places):
        yield (
            f"DRAWN_PLACES names {name!r}, which is no x-place array of python-backend/protocol_schema.py. "
            "Fix: remove it here, or mark the field's numbers x-place there."
        )


def problems(flows: list[Flow], known: dict[str, str] = KNOWN_FLOWS) -> Iterator[str]:
    """What fails: a flow not in ``known``, and a known one no longer found."""
    keys = {flow.key for flow in flows}
    for flow in flows:
        if flow.key not in known:
            module, function = flow.where.split(":")
            via = f" (reached through {' ← '.join(flow.path)})" if flow.path else ""
            yield (
                f"python-backend/{module}.py:{flow.line} {function}: {flow.what} — a number made of points thinned "
                f"to draw by {', '.join(flow.sources)}{via}. Take it from the full data (display rules R1, R2)."
            )
    for key in sorted(set(known) - keys):
        yield f"KNOWN_FLOWS lists a flow no longer found (remove its line; close {known[key]} if fixed): {key}"


def main(argv: list[str] | None = None) -> int:
    try:
        return _main(argv)
    except Unfinished as unfinished:
        for stop in unfinished.stops:
            print(stop, file=sys.stderr)
        print(
            f"check_decimation_flow: the analysis stopped at {len(unfinished.stops)} place(s) and checks nothing it "
            "did not follow. Rule: a check that cannot finish fails; it never passes what it did not see. Each line "
            "above names its file:line, why it stopped and the fix. See docs/plot-contracts-guide.md.",
            file=sys.stderr,
        )
        return 1


def _main(argv: list[str] | None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--list", action="store_true", help="print every flow found")
    parser.add_argument(
        "--readers", action="store_true", help="print, as JSON, every function computing with drawn points"
    )
    options = parser.parse_args(argv)
    if options.readers:
        print(json.dumps(find_readers(backend_sources())))
        return 0
    data = contract()
    listed = contract_decimators(data)
    expected = set(SOURCES) - BUCKET_RULE
    if listed != expected:
        print(
            f"check_decimation_flow: SOURCES here and 'decimators' in {CONTRACT.name} differ: "
            f"only here {sorted(expected - listed)}, only in the contract {sorted(listed - expected)}. "
            "Fix: list every function that thins data to draw it in both.",
            file=sys.stderr,
        )
        return 1
    places = list(schema_problems(protocol_definitions()))
    unclassified = list(unthinned_problems(find_unthinned(backend_sources()), contract_unthinned(data)))
    for problem in [*places, *unclassified]:
        print(problem, file=sys.stderr)
    if places or unclassified:
        print(
            f"check_decimation_flow: {len(unclassified)} problem(s) with values sent as drawn points and "
            f"{len(places)} with the places of drawn points. Rule: every value put in an x-drawn field of the protocol "
            "is classified: either a registered thinning function made it (SOURCES in this script and 'decimators' "
            f"in {CONTRACT.name}), so this check follows it, or 'unthinned' in {CONTRACT.name} lists the place "
            "with one sentence saying why every value is sent; and every name in DRAWN_PLACES is an x-place array "
            "of python-backend/protocol_schema.py. Each line above names its file:line and the fix for it. "
            "See docs/plot-contracts-guide.md.",
            file=sys.stderr,
        )
        return 1
    flows = find_flows(backend_sources())
    misclassified = draws_problems(backend_sources(), contract_draws(data))
    for problem in misclassified:
        print(problem, file=sys.stderr)
    if misclassified:
        print(
            f"check_decimation_flow: {len(misclassified)} 'draws' reader(s) do more than draw. Rule: a backend "
            "function classified use: 'draws' in python-backend/drawn_points_contract.json may put its thinned "
            "points only into a picture's drawn fields. Fix: take the number from the full data the function is "
            "given, before thinning (as value_range and difference_peak do), so the function only draws. (Classifying "
            "it 'value' instead makes its row a gap, which GAP_CEILING, 0, does not allow.) "
            "See docs/plot-contracts-guide.md.",
            file=sys.stderr,
        )
        return 1
    if options.list:
        for flow in flows:
            print(f"{flow.key}  [{', '.join(flow.sources)}] line {flow.line}  {' ← '.join(flow.path)}")
    found = list(problems(flows))
    for problem in found:
        print(problem, file=sys.stderr)
    if found:
        print(
            f"check_decimation_flow: {len(found)} problem(s). Rule: what the backend thins to draw never becomes a "
            "number sent to the app. Fix: take the number from the full data before thinning (as value_range and "
            "difference_peak do). See docs/plot-contracts-guide.md.",
            file=sys.stderr,
        )
        return 1
    print(f"check_decimation_flow: OK ({len(flows)} known flow(s), each held by a gap)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
