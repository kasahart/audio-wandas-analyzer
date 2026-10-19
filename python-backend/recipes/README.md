# Recipes

Each `*.recipe.json` file in this directory is a wandas Recipe: the JSON that
`wandas.pipeline.RecipePlan.save()` or `to_dict()` writes. The VS Code command
**Audio Wandas Analyzer: Run wandas recipe** and the static Web host send it to
`run-recipe`, where `recipe_runner.py` loads it with `RecipePlan.from_dict()`,
replays it with `apply()` and turns the output Frame into a chart titled
after the file name (a transfer function also gets a phase chart).

Recipe inputs must be Frames. The analyzer assigns the checked tracks to them
in the order the Recipe lists them, as calibrated analysis frames; the browser
uses already-loaded tracks instead of opening filesystem paths. Extra checked
tracks are ignored.

To add a recipe, run the workflow in wandas and save its plan:

```python
from wandas.pipeline import RecipePlan

result = signal.band_pass_filter(low_cutoff=100, high_cutoff=4000).welch(n_fft=4096)
RecipePlan.from_frame(result, input_names=("signal",)).save("python-backend/recipes/my-analysis")
```

Only Frame outputs can be saved, so scalar metrics such as `loudness_zwst()`
cannot be a recipe.
