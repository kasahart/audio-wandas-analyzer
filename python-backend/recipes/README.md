# Recipes

Each `*.recipe.json` file in this directory is a wandas Recipe: the JSON that
`wandas.pipeline.RecipePlan.save()` or `to_dict()` writes. **Export → Open
recipe…** opens one in the Compare step bar: its chain runs on each compared
recording and each step's Frame is drawn there, like a chain built with ＋.

A recipe with one Frame input opens as it is. A recipe with two inputs opens
when it joins the same channel of each (`get_channel`, then `concat_frame`) for a
cross-channel step such as `coherence` or `transfer_function`: the first input
(the reference) becomes the base slot and each compared recording the second.
Anything else says why it cannot open.

To add a recipe, run the workflow in wandas and save its plan:

```python
from wandas.pipeline import RecipePlan

result = signal.band_pass_filter(low_cutoff=100, high_cutoff=4000).welch(n_fft=4096)
RecipePlan.from_frame(result, input_names=("signal",)).save("python-backend/recipes/my-analysis")
```

The analyzer's **Workflow → Save as recipe** writes the same kind of file from
the bottom panel's current analysis (`recipe_builder.py`).

Only Frame outputs can be saved, so scalar metrics such as `loudness_zwst()`
cannot be a recipe.
